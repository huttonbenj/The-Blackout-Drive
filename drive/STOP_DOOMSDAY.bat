@echo off
:: ============================================================
:: DOOMSDAY DRIVE — Windows Emergency Stop
:: ============================================================
:: Run this if:
::  - You want to stop DOOMSDAY before unplugging the drive
::  - The main launcher was closed without proper shutdown
::  - You suspect Ollama is still running after removal
:: ============================================================

title DOOMSDAY // Emergency Shutdown

echo.
echo  [SHUTDOWN] Stopping DOOMSDAY system...
echo.

:: Kill all ollama processes
taskkill /f /im ollama.exe >nul 2>&1

:: Verify it's dead
timeout /t 1 /nobreak >nul
tasklist | findstr "ollama.exe" >nul 2>&1
if %errorlevel% == 0 (
    echo  [WARNING] Ollama still running. Forcing termination...
    taskkill /f /im ollama.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
) else (
    echo  [OK] DOOMSDAY system stopped successfully.
)

echo  [OK] Safe to unplug the drive.
echo.
timeout /t 3 /nobreak >nul
exit /b 0
