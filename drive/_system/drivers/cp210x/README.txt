Silicon Labs CP210x USB-to-UART Bridge Driver
==============================================

This folder should contain the CP210x driver files for Windows.

The Heltec V3 radio uses a CP2102 chip which requires this driver
on Windows. macOS and Linux include the driver natively.

REQUIRED FILES (download from Silicon Labs):
  silabser.inf    - Driver information file
  silabser.cat    - Signed catalog file
  x64/silabser.sys - 64-bit driver binary
  x86/silabser.sys - 32-bit driver binary

Download: https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers
  → "CP210x Universal Windows Driver" → Download ZIP → Extract here

License: Royalty-free redistribution permitted by Silicon Labs.
