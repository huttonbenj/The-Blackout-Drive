Run `scripts/download_runtime.sh` to populate this directory with Ollama binaries for all platforms.

Expected contents after running the script:
- ollama-windows/      → Windows x86_64 executable
- ollama-mac-arm/      → macOS Apple Silicon (M1/M2/M3)
- ollama-mac-intel/    → macOS Intel (x86_64)
- ollama-linux/        → Linux x86_64

These binaries are not tracked in git due to size (~50MB each).
