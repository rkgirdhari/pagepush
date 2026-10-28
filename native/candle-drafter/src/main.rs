use std::fs::File;
use std::io::{self, Read};

use anyhow::Context;
use candle::quantized::gguf_file;
use candle::{Device, Tensor};
use candle_transformers::generation::{LogitsProcessor, Sampling};
use candle_transformers::models::quantized_qwen3::ModelWeights;
use serde::{Deserialize, Serialize};
use tokenizers::Tokenizer;

#[derive(Debug, Deserialize)]
struct Request {
    system: String,
    user: String,
    #[serde(default = "default_max_tokens")]
    max_tokens: usize,
}

fn default_max_tokens() -> usize {
    384
}

#[derive(Debug, Serialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tokens: Option<usize>,
}

fn emit(response: &Response) {
    println!("{}", serde_json::to_string(response).unwrap_or_else(|_| {
        "{\"ok\":false,\"code\":\"protocol\",\"message\":\"could not encode the response\"}".to_string()
    }));
}

fn fail(code: &str, message: impl Into<String>) -> ! {
    emit(&Response {
        ok: false,
        text: None,
        code: Some(code.to_string()),
        message: Some(message.into()),
        tokens: None,
    });
    std::process::exit(2);
}

fn arg_value(flag: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == flag {
            return args.next();
        }
        if let Some(value) = arg.strip_prefix(&format!("{flag}=")) {
            return Some(value.to_string());
        }
    }
    None
}

fn chat(system: &str, user: &str) -> String {
    format!(
        "<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    )
}

fn json_complete(text: &str) -> bool {
    let Some(start) = text.find('{') else {
        return false;
    };
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for ch in text[start..].chars() {
        if in_string {
            if escape {
                escape = false;
                continue;
            }
            match ch {
                '\\' => escape = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn generate(
    model: &mut ModelWeights,
    tokenizer: &Tokenizer,
    prompt: &str,
    max_tokens: usize,
    device: &Device,
) -> anyhow::Result<(String, usize)> {
    let encoding = tokenizer
        .encode(prompt, true)
        .map_err(|err| anyhow::anyhow!(err.to_string()))
        .context("tokenizing the prompt")?;
    let tokens = encoding.get_ids().to_vec();
    if tokens.is_empty() {
        anyhow::bail!("the prompt produced no tokens");
    }
    let mut logits_processor = LogitsProcessor::from_sampling(0, Sampling::ArgMax);
    let input = Tensor::new(tokens.as_slice(), device)?.unsqueeze(0)?;
    let logits = model.forward(&input, 0)?.squeeze(0)?;
    let mut next_token = logits_processor.sample(&logits)?;
    let vocab = tokenizer.get_vocab(true);
    let eos = vocab.get("<|im_end|>").copied();
    let end_of_text = vocab.get("<|endoftext|>").copied();
    let mut produced = Vec::new();
    for index in 0..max_tokens {
        if Some(next_token) == eos || Some(next_token) == end_of_text {
            break;
        }
        produced.push(next_token);
        let text = tokenizer
            .decode(&produced, true)
            .map_err(|err| anyhow::anyhow!(err.to_string()))?;
        if json_complete(&text) {
            return Ok((text, produced.len()));
        }
        let step = Tensor::new(&[next_token], device)?.unsqueeze(0)?;
        let logits = model.forward(&step, tokens.len() + index)?.squeeze(0)?;
        next_token = logits_processor.sample(&logits)?;
    }
    let text = tokenizer
        .decode(&produced, true)
        .map_err(|err| anyhow::anyhow!(err.to_string()))?;
    Ok((text, produced.len()))
}

fn read_request() -> Request {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).unwrap_or_else(|err| {
        fail("protocol", format!("could not read stdin: {err}"));
    });
    match serde_json::from_str::<Request>(&raw) {
        Ok(request) if !request.system.trim().is_empty() && !request.user.trim().is_empty() => request,
        Ok(_) => fail("protocol", "system and user must be non-empty"),
        Err(err) => fail("protocol", format!("request JSON is invalid: {err}")),
    }
}

fn open_model(path: &str) -> File {
    File::open(path).unwrap_or_else(|err| fail("weights", format!("could not open the GGUF: {err}")))
}

fn main() {
    let model_path = arg_value("--model").unwrap_or_else(|| fail("weights", "pass --model"));
    let tokenizer_path = arg_value("--tokenizer").unwrap_or_else(|| fail("tokenizer", "pass --tokenizer"));
    let request = read_request();
    let max_tokens = request.max_tokens.clamp(1, 1024);
    let mut file = open_model(&model_path);
    let device = Device::Cpu;
    let mut model = {
        let content = gguf_file::Content::read(&mut file).unwrap_or_else(|err| {
            fail("weights", format!("GGUF header is unreadable: {err}"));
        });
        ModelWeights::from_gguf(content, &mut file, &device).unwrap_or_else(|err| {
            fail("weights", format!("Candle could not load this GGUF as Qwen3: {err}"));
        })
    };
    let tokenizer = Tokenizer::from_file(&tokenizer_path).unwrap_or_else(|err| {
        fail("tokenizer", format!("could not read tokenizer.json: {err}"));
    });
    let prompt = chat(&request.system, &request.user);
    match generate(&mut model, &tokenizer, &prompt, max_tokens, &device) {
        Ok((text, tokens)) => emit(&Response {
            ok: true,
            text: Some(text),
            code: None,
            message: None,
            tokens: Some(tokens),
        }),
        Err(err) => fail("runtime", err.to_string()),
    }
}
