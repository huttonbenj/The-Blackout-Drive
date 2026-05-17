Run `scripts/download_models.sh` to populate this directory with AI model weights.

Expected contents after running the script:
- Qwen3-4B-Q4_K_M.gguf   → Qwen3 4B  (~2.3GB) — selected on systems with <20GB RAM
- Qwen3-8B-Q4_K_M.gguf   → Qwen3 8B  (~5.1GB) — selected on systems with 20GB+ RAM

Model selection is automatic. The BEACON engine detects host RAM at boot
and loads the optimal model. Both editions of The Blackout Drive (64GB
Standard and 128GB Professional) ship with both models and run the same
adaptive software.

These files are not tracked in git due to size.
License: Both models are Apache 2.0 (Alibaba Cloud). See LEGAL/QWEN3_LICENSE.txt.
