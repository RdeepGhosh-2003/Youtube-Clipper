@echo off
setlocal enabledelayedexpansion

:: Guarantee working directory is the folder where start.bat resides
cd /d "%~dp0"

title YouTube Clipper - System Check ^& Launcher
color 0B

echo =====================================================================
echo                YouTube Clipper - Automatic Setup ^& Launcher
echo =====================================================================
echo.

:: -----------------------------------------------------------------------
:: 1. CHECK VIRTUAL ENVIRONMENT OR SYSTEM PYTHON
:: -----------------------------------------------------------------------
set "PYTHON_EXE="

:: Check if local virtual environment already exists and works
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -c "import sys" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        set "PYTHON_EXE=.venv\Scripts\python.exe"
        echo [OK] Local Python virtual environment .venv detected.
        goto :CHECK_DEPS
    )
)

echo [*] Checking Python installation on your system...

:: Check standard python command
python -c "import sys; sys.exit(0)" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "SYS_PYTHON=python"
    goto :PYTHON_FOUND
)

:: Check py launcher
py -c "import sys; sys.exit(0)" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "SYS_PYTHON=py"
    goto :PYTHON_FOUND
)

:: Check common AppData or ProgramFiles paths
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set "SYS_PYTHON=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    goto :PYTHON_FOUND
)
if exist "%ProgramFiles%\Python311\python.exe" (
    set "SYS_PYTHON=%ProgramFiles%\Python311\python.exe"
    goto :PYTHON_FOUND
)

:: -----------------------------------------------------------------------
:: PYTHON NOT FOUND -> AUTOMATIC ONE-CLICK INSTALLATION
:: -----------------------------------------------------------------------
echo.
echo [!] Python is not installed on this system.
echo [*] Installing Python 3.11 automatically for you, please wait 1-2 minutes...
echo.

:: Try winget first
where winget >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [*] Using Windows Package Manager winget...
    winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements --silent
    ping -n 4 127.0.0.1 >nul
)

:: If still not installed, download official installer via PowerShell
python -c "import sys" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [*] Downloading official Python installer from python.org...
    powershell -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe', '$env:TEMP\python_installer.exe'); Start-Process '$env:TEMP\python_installer.exe' -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 SimpleInstall=1' -Wait"
    ping -n 4 127.0.0.1 >nul
)

:: Update current session PATH so newly installed Python is immediately visible
set "PATH=%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;%ProgramFiles%\Python311;%ProgramFiles%\Python311\Scripts;%PATH%"

python -c "import sys" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "SYS_PYTHON=python"
    goto :PYTHON_FOUND
)
py -c "import sys" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set "SYS_PYTHON=py"
    goto :PYTHON_FOUND
)
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set "SYS_PYTHON=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    goto :PYTHON_FOUND
)

echo.
echo [X] Could not automatically install Python.
echo     Please download and install Python from: https://www.python.org/downloads/
echo     Make sure to check the box 'Add Python to PATH' during installation.
echo.
pause
exit /b 1

:PYTHON_FOUND
for /f "tokens=2" %%v in ('%SYS_PYTHON% -V 2^>^&1') do set "PY_VER=%%v"
echo [OK] Found Python %PY_VER%

:: Create isolated virtual environment
if not exist ".venv\Scripts\python.exe" (
    echo [*] Creating isolated virtual environment .venv...
    %SYS_PYTHON% -m venv .venv
    if not exist ".venv\Scripts\python.exe" (
        echo [!] Could not create .venv. Falling back to system Python.
        set "PYTHON_EXE=%SYS_PYTHON%"
        goto :CHECK_DEPS
    )
)
set "PYTHON_EXE=.venv\Scripts\python.exe"

:CHECK_DEPS
:: -----------------------------------------------------------------------
:: 2. CHECK & INSTALL PYTHON DEPENDENCIES & FFMPEG
:: -----------------------------------------------------------------------
echo [*] Checking required packages: FastAPI, yt-dlp, FFmpeg, Uvicorn...

"%PYTHON_EXE%" -c "import fastapi, uvicorn, yt_dlp, pydantic, imageio_ffmpeg" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] All required packages are ready.
) else (
    echo [*] Installing required packages from backend\requirements.txt...
    echo     This happens once on first-time setup, please wait a moment...
    "%PYTHON_EXE%" -m pip install --upgrade pip --quiet
    "%PYTHON_EXE%" -m pip install -r backend\requirements.txt
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo [X] Failed to install packages. Please check your internet connection.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Packages installed successfully!
)

:: -----------------------------------------------------------------------
:: 3. CHECK FRONTEND ASSETS
:: -----------------------------------------------------------------------
if exist "frontend\dist\index.html" (
    echo [OK] Web interface ready.
) else (
    echo [!] Web interface bundle not found.
    where npm >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo [*] Building frontend with npm...
        cd frontend && npm install && npm run build && cd ..
    ) else (
        echo [!] Node.js/npm not detected. Using available files.
    )
)

:: -----------------------------------------------------------------------
:: 4. CLEAN OLD SESSIONS ON PORT 8000 & LAUNCH
:: -----------------------------------------------------------------------
echo [*] Checking for previous instances on port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo.
echo =====================================================================
echo [OK] Setup check complete! Everything is ready.
echo [*] Launching YouTube Clipper in background...
echo     Opening http://127.0.0.1:8000 in your browser...
echo =====================================================================

start "YouTube Clipper Server" /min "%PYTHON_EXE%" "%~dp0run_app.py"

ping -n 3 127.0.0.1 >nul
exit
