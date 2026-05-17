@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: The Blackout Drive -- Windows Launcher
:: ============================================================
:: This script launches The Blackout Drive offline AI system.
:: It runs entirely from the USB drive -- nothing is installed
:: on your computer. All data stays on the drive.
::
:: Requirements: Windows 10 or 11, 8GB+ RAM, USB 3.0+ port
:: ============================================================

title The Blackout Drive // Offline AI. Encrypted Data.

:: Get the drive letter this script is running from
set "DRIVE_ROOT=%~d0"
set "SCRIPT_DIR=%~dp0"

:: -- Load configuration (single source of truth) ----------------
call "%SCRIPT_DIR%config.bat"

echo.
echo  ===================================================================
echo.
echo            T H E   B L A C K O U T   D R I V E
echo.
echo  ===================================================================
echo   OFFLINE AI. ENCRYPTED DATA.
echo   No internet required. No data leaves this drive.
echo  ===================================================================
echo.

:: ═════════════════════════════════════════════════════════════════
:: Phase 1/5: Detect Hardware
:: ═════════════════════════════════════════════════════════════════
echo  -- Phase 1/5: Detect Hardware ------------------------------------
echo.

set "OLLAMA_EXE=%SCRIPT_DIR%runtime\ollama-windows\ollama.exe"

if not exist "%OLLAMA_EXE%" (
    echo  [X] Runtime not found: %OLLAMA_EXE%
    echo.
    echo  This drive may not be fully set up. If you are the developer,
    echo  run scripts\download_runtime.sh to populate the runtime folder.
    echo.
    pause
    exit /b 1
)

:: -- Find a working Python interpreter --------------
set "PYTHON_EXE="

set "BUNDLED_PYTHON=%SCRIPT_DIR%runtime\python-windows\python.exe"
if exist "%BUNDLED_PYTHON%" (
    set "PYTHON_EXE=%BUNDLED_PYTHON%"
    goto :python_found
)

py -3 --version >nul 2>&1
if %errorlevel% == 0 (
    set "PYTHON_EXE=py -3"
    goto :python_found
)
python3 --version >nul 2>&1
if %errorlevel% == 0 (
    set "PYTHON_EXE=python3"
    goto :python_found
)
python --version >nul 2>&1
if %errorlevel% == 0 (
    set "PYTHON_EXE=python"
    goto :python_found
)

echo.
echo  [X] Python runtime not found.
echo.
echo  The bundled Python was not found at:
echo    %BUNDLED_PYTHON%
echo.
echo  You can install Python 3 manually from: https://www.python.org/downloads/
echo  During install, check "Add Python to PATH".
echo.
pause
exit /b 1

:python_found

:: -- Setup model from models.json --------------------
%PYTHON_EXE% "%SCRIPT_DIR%model_setup.py" "%SCRIPT_DIR%." --generate-modelfile --print-config --auto-detect > "%TEMP%\blackout_model_config.txt" 2>"%TEMP%\blackout_model_setup_err.txt"
if !errorlevel! NEQ 0 (
    echo  [X] Model setup failed. Details:
    type "%TEMP%\blackout_model_setup_err.txt"
    echo.
    pause
    exit /b 1
)

set "BLACKOUT_DEBUG=0"
set "BLACKOUT_LOG_DIR="
for /f "tokens=1,* delims==" %%a in (%TEMP%\blackout_model_config.txt) do (
    if "%%a"=="MODEL_FILE" set "BLACKOUT_MODEL_FILE=%%b"
    if "%%a"=="MODEL_NAME" set "BLACKOUT_MODEL_NAME=%%b"
    if "%%a"=="MODEL_DISPLAY" set "BLACKOUT_MODEL_DISPLAY=%%b"
    if "%%a"=="MODEL_GGUF" set "BLACKOUT_MODEL_GGUF=%%b"
    if "%%a"=="MODEL_TIER" set "BLACKOUT_MODEL_TIER=%%b"
    if "%%a"=="DEBUG" set "BLACKOUT_DEBUG=%%b"
    if "%%a"=="LOG_DIR" set "BLACKOUT_LOG_DIR=%%b"
    if "%%a"=="OLLAMA_PORT" set "BLACKOUT_OLLAMA_PORT=%%b"
    if "%%a"=="OLLAMA_BIND" set "BLACKOUT_OLLAMA_BIND=%%b"
    if "%%a"=="UI_PORT" set "BLACKOUT_UI_PORT=%%b"
    if "%%a"=="OLLAMA_HOST_ADDR" set "BLACKOUT_OLLAMA_HOST_ADDR=%%b"
    if "%%a"=="OLLAMA_URL" set "BLACKOUT_OLLAMA_URL=%%b"
    if "%%a"=="UI_URL" set "BLACKOUT_UI_URL=%%b"
    if "%%a"=="OLLAMA_ORIGINS" set "BLACKOUT_OLLAMA_ORIGINS=%%b"
)

echo  [OK] Windows x86_64
echo  [OK] Model: !BLACKOUT_MODEL_DISPLAY! ^(!BLACKOUT_MODEL_FILE!^)

:: -- Setup debug logging if enabled --------------------------
set "LOG_FILE=NUL"
if "!BLACKOUT_DEBUG!"=="1" (
    if not exist "!BLACKOUT_LOG_DIR!" mkdir "!BLACKOUT_LOG_DIR!"
    set "LOG_FILE=!BLACKOUT_LOG_DIR!\boot.log"
    echo ================================================================ >> "!LOG_FILE!"
    echo  Boot started: %DATE% %TIME% >> "!LOG_FILE!"
    echo  Model: !BLACKOUT_MODEL_DISPLAY! ^(!BLACKOUT_MODEL_FILE!^) >> "!LOG_FILE!"
    echo  Debug: ON >> "!LOG_FILE!"
    echo ================================================================ >> "!LOG_FILE!"
    echo  [OK] Debug log: !LOG_FILE!
)

set "MODEL_FILE=%SCRIPT_DIR%models\!BLACKOUT_MODEL_FILE!"
if not exist "!MODEL_FILE!" (
    echo  [X] AI model not found: !MODEL_FILE!
    echo.
    echo  This drive may not be fully set up. If you are the developer,
    echo  run scripts\download_models.sh to download the model.
    echo.
    pause
    exit /b 1
)

:: ═════════════════════════════════════════════════════════════════
:: Phase 2/5: Start AI Engine
:: ═════════════════════════════════════════════════════════════════
echo.
echo  -- Phase 2/5: Start AI Engine ------------------------------------
echo.

:: Clean up any existing instances
echo  Cleaning previous sessions...
taskkill /f /im ollama.exe >nul 2>&1
taskkill /fi "WINDOWTITLE eq OllamaServe" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq BlackoutDriveServer" /f >nul 2>&1

:: Wait for port to be free
set /a KILL_WAIT=0
:kill_verify
ping -n 2 127.0.0.1 >nul 2>&1
curl.exe -s -o nul -w "" --connect-timeout 1 --max-time 2 "http://127.0.0.1:!BLACKOUT_OLLAMA_PORT!" >nul 2>&1
if !errorlevel! NEQ 0 goto :port_free
set /a KILL_WAIT+=1
if !KILL_WAIT! GEQ 10 (
    echo  Port !BLACKOUT_OLLAMA_PORT! still in use. Proceeding...
    goto :port_free
)
echo  Releasing port !BLACKOUT_OLLAMA_PORT!... ^(!KILL_WAIT!s^)
goto :kill_verify
:port_free
if "!BLACKOUT_DEBUG!"=="1" (
    if !KILL_WAIT! GTR 0 (
        echo  [BOOT] Port released after !KILL_WAIT! seconds >> "!LOG_FILE!"
    ) else (
        echo  [BOOT] Port was free immediately >> "!LOG_FILE!"
    )
)

:: -- Set environment -- point Ollama to the drive ---
if not exist "%SCRIPT_DIR%data" mkdir "%SCRIPT_DIR%data"
set "OLLAMA_HOME=%SCRIPT_DIR%data\ollama_home"
if not exist "%OLLAMA_HOME%" mkdir "%OLLAMA_HOME%"
set "OLLAMA_MODELS=%SCRIPT_DIR%data\ollama_models"
if not exist "%OLLAMA_MODELS%" mkdir "%OLLAMA_MODELS%"
set "OLLAMA_HOST=%BLACKOUT_OLLAMA_HOST_ADDR%"
set "OLLAMA_ORIGINS=%BLACKOUT_OLLAMA_ORIGINS%"
set "OLLAMA_VULKAN=1"
set "OLLAMA_FLASH_ATTENTION=1"
set "OLLAMA_KV_CACHE_TYPE=q8_0"
set "OLLAMA_KEEP_ALIVE=30m"
set "OLLAMA_MAX_LOADED_MODELS=1"
set "OLLAMA_NUM_PARALLEL=1"
set "OLLAMA_NOPRUNE=1"
set "OLLAMA_NO_CLOUD=1"
set "OLLAMA_LOAD_TIMEOUT=120s"
if "!BLACKOUT_DEBUG!"=="1" (
    set "OLLAMA_DEBUG=1"
    echo  [BOOT] Ollama debug logging enabled >> "!LOG_FILE!"
) else (
    set "OLLAMA_DEBUG="
)

:: Launch Ollama
echo  Starting Ollama server...
if "!BLACKOUT_DEBUG!"=="1" (
    echo  [BOOT] Starting Ollama: %OLLAMA_EXE% >> "!LOG_FILE!"
    start "OllamaServe" /min cmd /c ""%OLLAMA_EXE%" serve >> "!BLACKOUT_LOG_DIR!\ollama.log" 2>&1"
) else (
    start "OllamaServe" /min cmd /c ""%OLLAMA_EXE%" serve >nul 2>&1"
)

:: Wait for Ollama with counter
set /a WAIT_COUNT=0
set "POLL_URL=!BLACKOUT_OLLAMA_URL!"

:wait_loop
ping -n 4 127.0.0.1 >nul 2>&1
set "CURL_RESULT=1"
curl.exe -s -o nul -w "" --connect-timeout 2 --max-time 3 "!POLL_URL!" >nul 2>&1
if !errorlevel! == 0 set "CURL_RESULT=0"
if "!CURL_RESULT!"=="0" goto :ollama_ready
set /a WAIT_COUNT+=1
if "!BLACKOUT_DEBUG!"=="1" echo  [BOOT] Poll !WAIT_COUNT!/60: AI engine not ready yet >> "!LOG_FILE!"
echo  / Waiting for AI engine to respond... ^(!WAIT_COUNT!s^)
if !WAIT_COUNT! GEQ 60 goto :ollama_timeout
goto :wait_loop

:ollama_timeout
echo.
echo  [X] AI engine not responding after 3 minutes.
echo.
echo  Possible causes:
echo    - Windows Firewall blocking port !BLACKOUT_OLLAMA_PORT!
echo    - Another program using port !BLACKOUT_OLLAMA_PORT!
echo    - Insufficient RAM (need 8GB minimum)
echo.
echo  Check the log file for details:
echo    !BLACKOUT_LOG_DIR!\ollama.log
echo.
pause
exit /b 1

:ollama_ready
echo  [OK] AI engine online
if "!BLACKOUT_DEBUG!"=="1" echo  [BOOT] Ollama API ready at %BLACKOUT_OLLAMA_URL% >> "!LOG_FILE!"

:: ═════════════════════════════════════════════════════════════════
:: Phase 3/5: Start Interface (BEFORE model load — UI handles warming state)
:: ═════════════════════════════════════════════════════════════════
echo.
echo  -- Phase 3/5: Start Interface ------------------------------------
echo.

if "!BLACKOUT_DEBUG!"=="1" (
    start "BlackoutDriveServer" /min %PYTHON_EXE% "%SCRIPT_DIR%server.py" %BLACKOUT_UI_PORT% "%SCRIPT_DIR%." --debug "!BLACKOUT_LOG_DIR!"
) else (
    start "BlackoutDriveServer" /min %PYTHON_EXE% "%SCRIPT_DIR%server.py" %BLACKOUT_UI_PORT% "%SCRIPT_DIR%."
)

:: Verify UI server started
set /a UI_WAIT=0
:ui_wait_loop
ping -n 2 127.0.0.1 >nul 2>&1
curl.exe -s -o nul -w "" --connect-timeout 2 --max-time 3 "http://127.0.0.1:%BLACKOUT_UI_PORT%/api/status" >nul 2>&1
if !errorlevel! == 0 goto :ui_ready
set /a UI_WAIT+=1
if !UI_WAIT! GEQ 15 (
    echo.
    echo  [X] UI server failed to start.
    echo  Try running manually:
    echo    %PYTHON_EXE% "%SCRIPT_DIR%server.py" %BLACKOUT_UI_PORT% "%SCRIPT_DIR%"
    echo.
    pause
    exit /b 1
)
echo  Waiting for web server... ^(!UI_WAIT!s^)
goto :ui_wait_loop

:ui_ready
echo  [OK] Web server on %BLACKOUT_UI_URL%

:: ═════════════════════════════════════════════════════════════════
:: Phase 4/5: Open Browser (user sees "WARMING UP" screen immediately)
:: ═════════════════════════════════════════════════════════════════
echo.
echo  -- Phase 4/5: Open Browser ---------------------------------------
echo.
start "" %BLACKOUT_UI_URL%/ui/
echo  [OK] Launched browser

:: ═════════════════════════════════════════════════════════════════
:: Phase 5/5: Load BEACON Model (runs AFTER browser is open)
:: ═════════════════════════════════════════════════════════════════
echo.
echo  -- Phase 5/5: Load BEACON Model ---------------------------------
echo.

:: Check if ollama create can be skipped (model registered + Modelfile unchanged)
set "MODELFILE_PATH=%SCRIPT_DIR%Modelfile.generated"
set "HASH_FILE=%SCRIPT_DIR%data\.modelfile_hash"
set "CURRENT_HASH="
set "PREVIOUS_HASH="
set "SKIP_CREATE=0"

:: Compute current Modelfile hash
for /f "skip=1 delims=" %%h in ('certutil -hashfile "!MODELFILE_PATH!" SHA256 2^>nul') do (
    if not defined CURRENT_HASH set "CURRENT_HASH=%%h"
)
:: Read previous hash
if exist "!HASH_FILE!" (
    set /p PREVIOUS_HASH=<"!HASH_FILE!"
)
:: Check if model is already registered
curl.exe -s -o "%TEMP%\bd_tags.json" --connect-timeout 2 --max-time 3 "!BLACKOUT_OLLAMA_URL!/api/tags" >nul 2>&1
if !errorlevel! == 0 (
    %PYTHON_EXE% -c "import sys,json;data=json.load(open(sys.argv[1]));names=[m.get('name','').split(':')[0] for m in data.get('models',[])];print('yes' if '!BLACKOUT_MODEL_NAME!'.split(':')[0] in names else 'no')" "%TEMP%\bd_tags.json" 2>nul > "%TEMP%\bd_model_exists.txt"
    set /p MODEL_EXISTS=<"%TEMP%\bd_model_exists.txt"
) else (
    set "MODEL_EXISTS=no"
)

if "!MODEL_EXISTS!"=="yes" if "!CURRENT_HASH!"=="!PREVIOUS_HASH!" if defined CURRENT_HASH (
    set "SKIP_CREATE=1"
)

if "!SKIP_CREATE!"=="1" (
    echo  [OK] BEACON model already registered ^(skipped import^)
) else (
    echo  Importing !BLACKOUT_MODEL_DISPLAY! into engine...
    if "!BLACKOUT_DEBUG!"=="1" (
        "%OLLAMA_EXE%" create "!BLACKOUT_MODEL_NAME!" -f "!MODELFILE_PATH!" >> "!BLACKOUT_LOG_DIR!\ollama.log" 2>&1
    ) else (
        "%OLLAMA_EXE%" create "!BLACKOUT_MODEL_NAME!" -f "!MODELFILE_PATH!" >nul 2>&1
    )
    if !errorlevel! NEQ 0 (
        echo.
        echo  [X] Model creation failed.
        echo  The Modelfile or GGUF may be missing or corrupted.
        echo  Expected: !MODEL_FILE!
        echo.
        pause
        exit /b 1
    )
    :: Save hash so we can skip next time
    echo !CURRENT_HASH!>"!HASH_FILE!"
    echo  [OK] BEACON model registered
)

:: Pre-warm model into GPU memory (Backgrounded)
echo.
echo  Loading model into GPU memory (background)...
echo.
start "" /B curl.exe -s --max-time 120 -X POST "%BLACKOUT_OLLAMA_URL%/api/generate" -d "{\"model\":\"!BLACKOUT_MODEL_NAME!\",\"prompt\":\"\",\"keep_alive\":\"30m\"}" >nul 2>&1
echo  [OK] BEACON warming up

echo.
echo  ===================================================================
echo   The Blackout Drive is READY
echo  ===================================================================
echo.
echo   If the browser didn't open, go to:
echo     %BLACKOUT_UI_URL%/ui/
echo.
echo   KEEP THIS WINDOW OPEN -- it powers the AI.
echo.
echo   When done: close the browser tab.
echo   This window will close on its own within a minute.
echo   Then you can safely unplug the drive.
echo.
echo  ===================================================================
echo.

REM Delete any stale sentinel from a previous run
if exist "%SCRIPT_DIR%data\.shutdown_sentinel" del /q "%SCRIPT_DIR%data\.shutdown_sentinel" >nul 2>&1

:shutdown_loop
if exist "%SCRIPT_DIR%data\.shutdown_sentinel" (
    echo.
    echo  [SHUTDOWN] Browser closed -- shutting down automatically...
    del /q "%SCRIPT_DIR%data\.shutdown_sentinel" >nul 2>&1
    goto :do_shutdown
)
ping -n 3 127.0.0.1 >nul 2>&1
goto :shutdown_loop

:do_shutdown
echo.
echo  [SHUTDOWN] Shutting down BEACON system...
taskkill /f /im ollama.exe >nul 2>&1
taskkill /fi "WINDOWTITLE eq OllamaServe" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq BlackoutDriveServer" /f >nul 2>&1
echo  [SHUTDOWN] System offline. All data remains on your drive.
echo.
ping -n 4 127.0.0.1 >nul 2>&1

endlocal
exit /b 0
