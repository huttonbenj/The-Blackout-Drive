:: ============================================================
:: The Blackout Drive -- Batch Configuration (Windows)
:: ============================================================
:: BOOTSTRAP ONLY -- provides minimal defaults before Python is
:: available. The real config lives in config.json and is loaded
:: by model_setup.py, which outputs all values as KEY=VALUE.
::
:: The launcher parses model_setup.py output and OVERRIDES these
:: values with the ones from config.json. Do NOT change ports or
:: model names here -- edit config.json instead.
::
:: Called by: START_WINDOWS.bat (for initial variable setup)
:: ============================================================

:: -- Product Identity --------------------------------------
set "BLACKOUT_APP_NAME=The Blackout Drive"
set "BLACKOUT_VERSION=1.0.0"

:: -- Bootstrap Defaults (overridden by config.json) -------
:: These are ONLY used before model_setup.py runs.
:: After that, the launcher uses values from config.json.
set "BLACKOUT_MODEL_NAME=blackout-beacon"
set "BLACKOUT_OLLAMA_BIND=127.0.0.1"
set "BLACKOUT_OLLAMA_PORT=11434"
set "BLACKOUT_UI_PORT=8080"

:: -- Derived Values (do not edit) -------------------------
set "BLACKOUT_OLLAMA_HOST_ADDR=%BLACKOUT_OLLAMA_BIND%:%BLACKOUT_OLLAMA_PORT%"
set "BLACKOUT_OLLAMA_URL=http://127.0.0.1:%BLACKOUT_OLLAMA_PORT%"
set "BLACKOUT_UI_URL=http://127.0.0.1:%BLACKOUT_UI_PORT%"
set "BLACKOUT_OLLAMA_ORIGINS=http://127.0.0.1:%BLACKOUT_UI_PORT%"

:: -- Drive Root (auto-detected from config.bat location) --
set "BLACKOUT_DRIVE_ROOT=%~dp0"
