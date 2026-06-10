@echo off
:: ============================================================
:: The Blackout Drive -- Windows First Run / SmartScreen Fix
:: ============================================================
:: Windows SmartScreen and Defender may block unsigned scripts.
:: This adds the drive folder to Windows Defender's exclusions
:: so The Blackout Drive can run without interruption.
::
:: This script requires Administrator privileges.
:: Right-click -> "Run as Administrator" if prompted.
::
:: HOW TO USE: Run this ONCE on first use. After that, use
:: START_WINDOWS.bat for all future sessions.
:: ============================================================

title The Blackout Drive // First Run Setup

:: Check for admin rights
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo.
    echo  [INFO] Requesting Administrator privileges...
    echo  Windows will ask for permission. Click Yes to continue.
    echo.
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo  The Blackout Drive -- First Run Setup
echo  -------------------------------------------------------
echo  Adding drive folder to Windows Defender exclusions...
echo.

:: Get drive root
set "DRIVE_ROOT=%~d0\"

:: Add exclusion via PowerShell
powershell -Command "Add-MpPreference -ExclusionPath '%DRIVE_ROOT%' -ErrorAction SilentlyContinue"
if %errorlevel% == 0 (
    echo  [OK] Windows Defender exclusion added for: %DRIVE_ROOT%
) else (
    echo  [INFO] Could not add exclusion ^(Defender may be managed by policy^)
    echo  You may need to manually allow the app if prompted.
)

:: Unblock all files on the drive using PowerShell Unblock-File
echo  [INFO] Unblocking downloaded files...
powershell -Command "Get-ChildItem -Path '%DRIVE_ROOT%' -Recurse | Unblock-File -ErrorAction SilentlyContinue"
echo  [OK] Files unblocked.

echo.
echo  -------------------------------------------------------
echo  Setup complete. Launching The Blackout Drive...
echo  -------------------------------------------------------
echo.
timeout /t 2 /nobreak >nul

:: Hand off to main launcher (in same _system directory)
call "%~dp0START_WINDOWS.bat"
