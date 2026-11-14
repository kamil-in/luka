@echo off
setlocal
cd /d "%~dp0"
title Building FM-1 Community Firmwares and Generating Documentation...

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-firmwares.ps1" %*

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] An error occurred while running build-firmwares.ps1.
) else (
    echo.
    echo [DONE] Single-click build and documentation generation completed successfully!
)

echo.
pause
