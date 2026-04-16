@echo off
title StormPath - local server
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo  Node.js is not installed or not in PATH.
    echo  Install the LTS version from https://nodejs.org
    echo  Then close this window, reopen it, and double-click RUN_APP.bat again.
    echo.
    pause
    exit /b 1
)

:: Free port 5173 if a stale process is holding it (common after unclean exit)
echo  Checking port 5173...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":5173 "') do (
    echo  Killing stale process %%p on port 5173...
    taskkill /PID %%p /F >nul 2>nul
)

echo.
echo  Installing dependencies (first time can take a minute)...
call npm install
if errorlevel 1 (
    echo.
    echo  npm install failed. Copy the red text above and ask for help.
    pause
    exit /b 1
)

echo.
echo  Starting the app on http://localhost:5173/
echo  On your PHONE (same Wi-Fi): use the Network http://192.168... link.
echo  Close this window to stop the app.
echo.
call npm run dev -- --host
pause
