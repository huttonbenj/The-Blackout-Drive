@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: BEACON DRIVE — Windows Launcher
:: ============================================================
:: This script launches the BEACON offline AI system.
:: It runs entirely from the USB drive — nothing is installed
:: on your computer. All data stays on the drive.
::
:: Requirements: Windows 10 or 11, 8GB+ RAM, USB 3.0+ port
:: ============================================================

title The Blackout Drive // Offline Survival Intelligence

:: Get the drive letter this script is running from
set "DRIVE_ROOT=%~d0"
set "SCRIPT_DIR=%~dp0"

:: ── Load configuration (single source of truth) ────────────────
call "%SCRIPT_DIR%config.bat"

echo.
echo  ██████╗  ██████╗  ██████╗ ███╗   ███╗███████╗██████╗  █████╗ ██╗   ██╗    █████╗ ██╗
echo  ██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║██╔════╝██╔══██╗██╔══██╗╚██╗ ██╔╝   ██╔══██╗██║
echo  ██║  ██║██║   ██║██║   ██║██╔████╔██║███████╗██║  ██║███████║ ╚████╔╝    ███████║██║
echo  ██║  ██║██║   ██║██║   ██║██║╚██╔╝██║╚════██║██║  ██║██╔══██║  ╚██╔╝     ██╔══██║██║
echo  ██████╔╝╚██████╔╝╚██████╔╝██║ ╚═╝ ██║███████║██████╔╝██║  ██║   ██║   ██║██║  ██║██║
echo  ╚═════╝  ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝  ╚═╝╚═╝
echo.
echo  The Blackout Drive — OFFLINE SURVIVAL INTELLIGENCE
echo  -------------------------------------------------------
echo  No internet required. No data leaves this drive.
echo  -------------------------------------------------------
echo.

:: ── Step 1: Verify we can find our runtime ──────────────────
set "OLLAMA_EXE=%SCRIPT_DIR%runtime\ollama-windows\ollama.exe"

if not exist "%OLLAMA_EXE%" (
    echo  [ERROR] Runtime not found: %OLLAMA_EXE%
    echo.
    echo  This drive may not be fully set up. If you are the developer,
    echo  run scripts\download_runtime.sh to populate the runtime folder.
    echo.
    pause
    exit /b 1
)

:: ── Step 2: Check for model ──────────────────────────────────
set "MODEL_FILE=%SCRIPT_DIR%models\%BEACON_MODEL_FILE%"

if not exist "%MODEL_FILE%" (
    echo  [ERROR] AI model not found: %MODEL_FILE%
    echo.
    echo  This drive may not be fully set up. If you are the developer,
    echo  run scripts\download_models.sh to download the model.
    echo.
    pause
    exit /b 1
)

:: ── Step 3: Check if Ollama is already running ───────────────
curl -s %BEACON_OLLAMA_URL% >nul 2>&1
if %errorlevel% == 0 (
    echo  [INFO] BEACON system already running. Opening interface...
    goto :open_ui
)

:: ── Step 4: Set environment — point Ollama to the drive ─────
echo  [BOOT] Initializing BEACON system...
set "OLLAMA_MODELS=%SCRIPT_DIR%models"
set "OLLAMA_HOME=%SCRIPT_DIR%runtime\ollama-windows"
set "OLLAMA_HOST=%BEACON_OLLAMA_HOST_ADDR%"
set "OLLAMA_ORIGINS=%BEACON_OLLAMA_ORIGINS%"

:: ── Step 5: Launch Ollama in background ─────────────────────
start /b "" "%OLLAMA_EXE%" serve

:: ── Step 6: Wait for Ollama to be ready (up to 30 seconds) ──
echo  [BOOT] Starting AI engine...
set /a WAIT_COUNT=0
:wait_loop
timeout /t 1 /nobreak >nul
curl -s %BEACON_OLLAMA_URL% >nul 2>&1
if %errorlevel% == 0 goto :ollama_ready
set /a WAIT_COUNT+=1
if %WAIT_COUNT% GEQ 30 (
    echo  [ERROR] BEACON system failed to start after 30 seconds.
    echo  Check that your computer has at least 8GB of RAM.
    pause
    exit /b 1
)
echo  [BOOT] Waiting... (%WAIT_COUNT%/30)
goto :wait_loop

:ollama_ready
echo  [BOOT] AI engine online.

:: ── Step 7: Load the BEACON model ─────────────────────────
echo  [BOOT] Loading BEACON intelligence model...
"%OLLAMA_EXE%" run "%BEACON_MODEL_NAME%" "" >nul 2>&1

:: If model doesn't exist yet, create it from Modelfile
"%OLLAMA_EXE%" list | findstr "%BEACON_MODEL_NAME%" >nul 2>&1
if %errorlevel% NEQ 0 (
    echo  [BOOT] First run — building model...
    "%OLLAMA_EXE%" create "%BEACON_MODEL_NAME%" -f "%SCRIPT_DIR%%BEACON_MODELFILE%"
    echo  [BOOT] Model ready.
)

:open_ui
:: ── Step 8: Start UI server + open chat interface ────────────
echo  [BOOT] Starting UI server...
:: Serve UI via local HTTP (fixes CORS — browser can't call Ollama from file://)
start /b "" python "%REPO_ROOT%scripts\server.py" %BEACON_UI_PORT% "%SCRIPT_DIR%"
timeout /t 1 /nobreak >nul
start "" %BEACON_UI_URL%

echo.
echo  -------------------------------------------------------
echo  The Blackout Drive is online. Browser opening at %BEACON_UI_URL%
echo  
echo  If your browser doesn't open, navigate to:
echo  %BEACON_UI_URL%
echo.
echo  IMPORTANT: Keep this window open while using BEACON.
echo  Closing this window will shut down the AI system.
echo  -------------------------------------------------------
echo.

:: ── Step 9: Wait for user to close ──────────────────────────
echo  Press any key to shut down BEACON...
pause >nul

:: ── Step 10: Cleanup — kill Ollama + UI server on exit ───────
echo  [SHUTDOWN] Shutting down BEACON system...
taskkill /f /im ollama.exe >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
echo  [SHUTDOWN] System offline. All data remains on your drive.
echo.

endlocal
exit /b 0
