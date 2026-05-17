@echo off
:: ============================================================
:: The Blackout Drive -- Windows Launcher
:: ============================================================
:: Double-click this to start The Blackout Drive.
:: Works on first run AND every run after -- one file, no confusion.
:: ============================================================

set "SCRIPT_DIR=%~dp0_system\"

:: Check if _system folder exists
if not exist "%SCRIPT_DIR%config.bat" (
    echo.
    echo  [ERROR] System files not found.
    echo  Make sure the _system folder is present on this drive.
    echo.
    pause
    exit /b 1
)

:: -- First-run: unblock executables (safe to run every time) --
:: Windows marks USB files as "blocked". We only unblock the specific
:: runtime directories that contain executables -- NOT the whole drive.
:: This takes <2 seconds vs 15-30s for a full recursive scan.
echo  [SETUP] Preparing system files...
powershell -Command "Get-ChildItem -Path '%SCRIPT_DIR%runtime' -Recurse -Include '*.exe','*.dll' -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue; Get-ChildItem -Path '%SCRIPT_DIR%' -Depth 0 -Include '*.bat','*.cmd','*.py' -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

:: -- Hand off to the real launcher in _system -----------------
call "%SCRIPT_DIR%START_WINDOWS.bat"
set "BOOT_EXIT=%errorlevel%"

:: ALWAYS pause so the user can see what happened.
:: Under normal operation, START_WINDOWS.bat enters a shutdown_loop
:: and only returns here when the user deliberately shuts down.
:: If we reach here unexpectedly, it means the script crashed.
echo.
if %BOOT_EXIT% NEQ 0 (
    echo  ===================================================================
    echo  [ERROR] The Blackout Drive exited with code %BOOT_EXIT%
    echo  Check logs at: %SCRIPT_DIR%data\logs\
    echo  ===================================================================
) else (
    echo  The Blackout Drive has shut down.
)
echo.
pause
