@echo off
:: ============================================================
:: The Blackout Drive -- Windows Emergency Stop
:: ============================================================
:: Run this if:
::  - You want to stop BEACON before unplugging the drive
::  - The main launcher was closed without proper shutdown
::  - You suspect Ollama is still running after removal
:: ============================================================

echo.
echo  [SHUTDOWN] Stopping BEACON system...
echo.

:: Kill the Python UI server -- target by window title first (safe), then by command line
:: This avoids killing unrelated Python processes (Jupyter, VS Code, etc.)
taskkill /fi "WINDOWTITLE eq BlackoutDriveServer" /f >nul 2>&1
:: Also target any python running server.py specifically
wmic process where "name='python.exe' and commandline like '%%server.py%%'" call terminate >nul 2>&1
wmic process where "name='python3.exe' and commandline like '%%server.py%%'" call terminate >nul 2>&1

:: Kill Ollama
taskkill /f /im ollama.exe >nul 2>&1

echo  [OK] BEACON system stopped.
echo  [OK] Safe to unplug the drive.
echo.
pause
