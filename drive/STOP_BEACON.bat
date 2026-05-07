@echo off
:: ============================================================
:: The Blackout Drive — Windows Emergency Stop
:: ============================================================
:: Run this if:
::  - You want to stop BEACON before unplugging the drive
::  - The main launcher was closed without proper shutdown
::  - You suspect Ollama is still running after removal
:: ============================================================

echo.
echo  [SHUTDOWN] Stopping BEACON system...
echo.

:: Kill the Python UI server (started with window title "BlackoutDriveServer")
taskkill /fi "WINDOWTITLE eq BlackoutDriveServer" /f >nul 2>&1

:: Kill Ollama
taskkill /f /im ollama.exe >nul 2>&1

echo  [OK] BEACON system stopped.
echo  [OK] Safe to unplug the drive.
echo.
pause
