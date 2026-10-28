#![forbid(unsafe_code)]
// Page Push companion daemon.
//
// This is an entirely optional local HTTP service. The browser extension
// works fully offline without it (using built-in templates in
// sidepanel.js); if this daemon is running on 127.0.0.1:8080 the extension
// will prefer it for copy generation.
//
// By default this binary only implements deterministic, template-based
// copy generation (zero external dependencies, zero network egress). Build
// with `--features qwen3-gguf` and set HCC_QWEN3_GGUF / HCC_QWEN3_TOKENIZER
// to enable local inference via a quantized Qwen3 GGUF model through
// Hugging Face Candle instead.

use axum::{
    http::{HeaderValue, Method},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
    trace::TraceLayer,
};

#[cfg(feature = "qwen3-gguf")]
mod qwen3;

#[cfg(feature = "qwen3-gguf")]
use qwen3::LoadedQwen3;

#[derive(Clone)]
struct AppState {
    #[cfg(feature = "qwen3-gguf")]
    qwen3_engine: std::sync::Arc<tokio::sync::Mutex<Option<LoadedQwen3>>>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    engine: &'static str,
}

#[derive(Deserialize)]
struct InterviewRequest {
    company: String,
    focus: String,
    #[serde(default)]
    website: String,
}

#[derive(Serialize)]
struct InterviewResponse {
    bio: String,
    launch_post: String,
    engine: &'static str,
}

async fn health_handler(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> Json<HealthResponse> {
    #[cfg(feature = "qwen3-gguf")]
    let engine = {
        let guard = _state.qwen3_engine.lock().await;
        if guard.is_some() {
            "candle-quantized-qwen3-gguf"
        } else {
            "template-fallback"
        }
    };
    #[cfg(not(feature = "qwen3-gguf"))]
    let engine = "template-fallback";

    Json(HealthResponse {
        status: "operational",
        service: "Page Push daemon",
        engine,
    })
}

fn template_bio(company: &str, focus: &str, website: &str) -> String {
    let mut bio = if website.trim().is_empty() {
        format!("{} — {}.", company.trim(), focus.trim())
    } else {
        format!("{} — {}. {}", company.trim(), focus.trim(), website.trim())
    };
    bio.truncate(255); // Facebook's Page bio field has a 255 character limit.
    bio
}

fn template_launch_post(company: &str, focus: &str, website: &str) -> String {
    let mut post = format!(
        "{} is officially live on Facebook.\n\nWe help with: {}.",
        company.trim(),
        focus.trim()
    );
    if !website.trim().is_empty() {
        post.push_str(&format!("\n\nLearn more at {}.", website.trim()));
    }
    post
}

async fn interview_handler(
    axum::extract::State(_state): axum::extract::State<AppState>,
    Json(req): Json<InterviewRequest>,
) -> Json<InterviewResponse> {
    #[cfg(feature = "qwen3-gguf")]
    {
        let mut guard = _state.qwen3_engine.lock().await;
        if let Some(engine) = guard.as_mut() {
            let prompt = format!(
                "<|im_start|>system\nWrite a concise Facebook Page bio (under 240 characters) for {} focusing on {}.<|im_end|>\n<|im_start|>user\nWebsite: {}<|im_end|>\n<|im_start|>assistant\n",
                req.company, req.focus, req.website
            );
            if let Ok(output) = engine.generate(&prompt, 64) {
                let bio: String = output.trim().chars().take(250).collect();
                return Json(InterviewResponse {
                    bio,
                    launch_post: template_launch_post(&req.company, &req.focus, &req.website),
                    engine: "candle-quantized-qwen3-gguf",
                });
            }
        }
    }

    Json(InterviewResponse {
        bio: template_bio(&req.company, &req.focus, &req.website),
        launch_post: template_launch_post(&req.company, &req.focus, &req.website),
        engine: "template-fallback",
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info,page_push_daemon=debug,tower_http=debug")
        .init();

    // Only allow requests from the extension's own origins and the loopback
    // address itself. This daemon is not meant to be reachable from the
    // open internet or from arbitrary web pages.
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _parts| {
            let s = origin.to_str().unwrap_or("");
            s.starts_with("chrome-extension://")
                || s.starts_with("moz-extension://")
                || s == "http://127.0.0.1:8080"
                || s == "http://localhost:8080"
        }))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any);

    #[cfg(feature = "qwen3-gguf")]
    let qwen3_engine = {
        let loaded = LoadedQwen3::try_load_from_env().unwrap_or_else(|err| {
            tracing::warn!("Qwen3 GGUF not loaded, falling back to templates: {err}");
            None
        });
        std::sync::Arc::new(tokio::sync::Mutex::new(loaded))
    };

    let state = AppState {
        #[cfg(feature = "qwen3-gguf")]
        qwen3_engine,
    };

    let app = Router::new()
        .route("/api/v1/health", get(health_handler))
        .route("/api/v1/interview", post(interview_handler))
        .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 8080));
    tracing::info!("Page Push daemon listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
