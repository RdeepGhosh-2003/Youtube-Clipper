@echo off
cd /d "%~dp0"
title Stop YouTube Clipper

echo ===================================================
echo           Stopping YouTube Clipper
echo ===================================================
echo.

set "STOPPED="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
    set "STOPPED=1"
)

if defined STOPPED (
    echo [OK] YouTube Clipper server stopped successfully.
) else (
    echo [*] No running instance was found on port 8000.
)

echo.
ping -n 3 127.0.0.1 >nul
exit
