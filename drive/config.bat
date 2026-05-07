:: ============================================================
:: DOOMSDAY DRIVE — Batch Configuration (Windows)
:: ============================================================
:: Single source of truth for all configurable values.
:: Called by: START_WINDOWS.bat, FIRST_RUN_WINDOWS.bat
::
:: USAGE: Call this file at the top of any batch script:
::   call "%~dp0config.bat"
::
:: ⚠ IMPORTANT: If you change OLLAMA_PORT or MODEL_NAME here,
:: you MUST also update the matching values in:
::   → drive\ui\config.js  (JS cannot read batch variables)
:: ============================================================

:: ── Product Identity ──────────────────────────────────────
set "DOOMSDAY_APP_NAME=DOOMSDAY"
set "DOOMSDAY_VERSION=1.0.0"

:: ── AI Model ─────────────────────────────────────────────
:: MODEL_NAME: the Ollama model identifier (must match Modelfile)
:: BASE_MODEL: the upstream model to pull (shown during download)
:: MODELFILE:  filename of the Ollama Modelfile (relative to drive root)
:: MODEL_FILE: expected GGUF filename in the models\ directory
set "DOOMSDAY_MODEL_NAME=doomsday"
set "DOOMSDAY_BASE_MODEL=phi3:mini"
set "DOOMSDAY_MODELFILE=Modelfile"
set "DOOMSDAY_MODEL_FILE=phi3-mini.Q4_K_M.gguf"

:: ── Network ───────────────────────────────────────────────
:: OLLAMA_BIND: interface Ollama listens on (localhost only for security)
:: OLLAMA_PORT: Ollama API port (default: 11434)
:: UI_PORT:     local HTTP server port for the chat interface
set "DOOMSDAY_OLLAMA_BIND=127.0.0.1"
set "DOOMSDAY_OLLAMA_PORT=11434"
set "DOOMSDAY_UI_PORT=8080"

:: ── Derived Values (do not edit) ─────────────────────────
set "DOOMSDAY_OLLAMA_HOST_ADDR=%DOOMSDAY_OLLAMA_BIND%:%DOOMSDAY_OLLAMA_PORT%"
set "DOOMSDAY_OLLAMA_URL=http://localhost:%DOOMSDAY_OLLAMA_PORT%"
set "DOOMSDAY_UI_URL=http://localhost:%DOOMSDAY_UI_PORT%"
set "DOOMSDAY_OLLAMA_ORIGINS=http://localhost:%DOOMSDAY_UI_PORT%,http://127.0.0.1:%DOOMSDAY_UI_PORT%"
