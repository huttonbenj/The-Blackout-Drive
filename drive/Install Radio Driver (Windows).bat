@echo off
:: ============================================================
:: Install Radio Driver (CP210x) for The Blackout Drive
:: ============================================================
:: This script installs the Silicon Labs CP210x USB-to-UART
:: driver required for Heltec V3 Meshtastic radio hardware.
::
:: This only needs to run ONCE. After installation, the radio
:: will be automatically detected on every future connection.
::
:: Requires Administrator privileges (Windows will prompt).
:: ============================================================

:: Check if already running as admin
net session >nul 2>&1
if %errorlevel% == 0 goto :install

:: Not admin — re-launch elevated
echo.
echo  Requesting administrator privileges to install the radio driver...
echo  Please click "Yes" on the Windows prompt.
echo.
powershell -Command "Start-Process '%~f0' -Verb RunAs -Wait"
goto :done

:install
echo.
echo  ===================================================================
echo  INSTALLING RADIO DRIVER (CP210x / Silicon Labs)
echo  ===================================================================
echo.

set "DRIVER_DIR=%~dp0_system\drivers\cp210x"

if not exist "%DRIVER_DIR%\silabser.inf" (
    echo  [X] Driver files not found at:
    echo      %DRIVER_DIR%
    echo.
    echo  Expected file: silabser.inf
    echo  Please ensure the driver files are on the drive.
    echo.
    pause
    exit /b 1
)

:: Check if driver is already installed
pnputil /enum-drivers | findstr /i "silabser" >nul 2>&1
if %errorlevel% == 0 (
    echo  [OK] CP210x driver is already installed.
    echo.
    echo  If your radio still isn't detected, try unplugging and
    echo  re-plugging the USB cable.
    echo.
    timeout /t 5
    exit /b 0
)

:: Install the driver
echo  Installing driver from: %DRIVER_DIR%\silabser.inf
echo.
pnputil /add-driver "%DRIVER_DIR%\silabser.inf" /install
echo.

if %errorlevel% == 0 (
    echo  ===================================================================
    echo  [OK] DRIVER INSTALLED SUCCESSFULLY
    echo  ===================================================================
    echo.
    echo  You can now connect your Heltec V3 radio via USB.
    echo  The Blackout Drive will auto-detect it in the COMMS panel.
    echo.
    echo  If the radio was already plugged in, unplug and re-plug it.
    echo.
) else (
    echo  ===================================================================
    echo  [!] DRIVER INSTALLATION MAY HAVE FAILED
    echo  ===================================================================
    echo.
    echo  Error code: %errorlevel%
    echo  Try running this script again, or install manually:
    echo    1. Open Device Manager
    echo    2. Find the unknown device (yellow triangle)
    echo    3. Right-click → Update Driver → Browse my computer
    echo    4. Point to: %DRIVER_DIR%
    echo.
)

timeout /t 10

:done
