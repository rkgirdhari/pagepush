// Optional local inference backend using Hugging Face Candle with a
// quantized Qwen3 GGUF model. Only compiled when the `qwen3-gguf` feature
// is enabled. Requires HCC_QWEN3_GGUF (path to a .gguf file) and, optionally,
// HCC_QWEN3_TOKENIZER (path to tokenizer.json, defaults to ./tokenizer.json).

use candle_core::{quantized::gguf_file, Device, Tensor};
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_qwen3::ModelWeights as Qwen3Weights;
use std::path::PathBuf;

pub struct LoadedQwen3 {
    weights: Qwen3Weights,
    tokenizer: tokenizers::Tokenizer,
    device: Device,
}

impl LoadedQwen3 {
    pub fn try_load_from_env() -> anyhow::Result<Option<Self>> {
        let model_path = match std::env::var("HCC_QWEN3_GGUF") {
            Ok(val) if !val.trim().is_empty() => PathBuf::from(val),
            _ => return Ok(None),
        };
        let tokenizer_path = PathBuf::from(
            std::env::var("HCC_QWEN3_TOKENIZER").unwrap_or_else(|_| "tokenizer.json".to_string()),
        );

        let device = Device::Cpu;
        let mut file = std::fs::File::open(&model_path)?;
        let content = gguf_file::Content::read(&mut file)?;
        let weights = Qwen3Weights::from_gguf(content, &mut file, &device)?;
        let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| anyhow::anyhow!("tokenizer load error: {e}"))?;

        Ok(Some(Self {
            weights,
            tokenizer,
            device,
        }))
    }

    /// Greedy-ish sampled generation using the 2D `[batch=1, seq_len]` prefill
    /// tensor shape and `[1, 1]` per-step decode shape expected by
    /// `ModelWeights::forward`.
    pub fn generate(&mut self, prompt: &str, max_tokens: usize) -> anyhow::Result<String> {
        let encoding = self
            .tokenizer
            .encode(prompt, true)
            .map_err(|e| anyhow::anyhow!("encode error: {e}"))?;
        let prompt_tokens = encoding.get_ids();
        if prompt_tokens.is_empty() {
            anyhow::bail!("empty prompt tokens");
        }

        let mut logits_processor = LogitsProcessor::new(1337, Some(0.3), Some(0.9));
        let mut generated = Vec::with_capacity(max_tokens);

        let input = Tensor::new(prompt_tokens, &self.device)?.unsqueeze(0)?;
        let logits = self.weights.forward(&input, 0)?;
        let logits = logits.squeeze(0)?;
        let mut next_token = logits_processor.sample(&logits)?;
        generated.push(next_token);

        for step in 0..max_tokens.saturating_sub(1) {
            let pos = prompt_tokens.len() + step;
            let step_input = Tensor::new(&[next_token], &self.device)?.unsqueeze(0)?;
            let logits = self.weights.forward(&step_input, pos)?;
            let logits = logits.squeeze(0)?;
            next_token = logits_processor.sample(&logits)?;
            generated.push(next_token);
        }

        self.tokenizer
            .decode(&generated, true)
            .map_err(|e| anyhow::anyhow!("decode error: {e}"))
    }
}
