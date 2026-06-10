@echo off
echo.
echo ===========================================================
echo   THE BLACKOUT DRIVE — EMERGENCY RESTORE
echo ===========================================================
echo.
echo   This will restore all system files to factory defaults.
echo   Your USER_DATA (uploads, conversations) will NOT be touched.
echo.
set /p confirm="  Type RESTORE to confirm: "
if /i not "%confirm%"=="RESTORE" (
    echo.
    echo   Cancelled. No changes made.
    pause
    exit /b 0
)
echo.
echo   Restoring factory defaults...
xcopy /s /y "%~dp0_system\_factory\*" "%~dp0_system\" >nul 2>&1
echo.
echo   ✓ Factory defaults restored.
echo   Please restart the drive to apply changes.
echo.
pause
