@echo off
title Build website folder for Netlify (site: stormpath2)
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo  Node.js is not installed or not in PATH.
    echo  Install the LTS version from https://nodejs.org
    echo  Then double-click this file again.
    echo.
    pause
    exit /b 1
)

echo.
echo  Step 1/4 - Installing dependencies (first time can take a minute)...
call npm install
if errorlevel 1 (
    echo.
    echo  Something went wrong. Copy the text above and ask for help.
    pause
    exit /b 1
)

echo.
echo  Step 2/4 - Building + verifying dist for Netlify...
call npm run build:netlify
if errorlevel 1 (
    echo.
    echo  Build or Netlify verification failed. Do NOT deploy until this passes.
    pause
    exit /b 1
)

echo.
echo  Step 3/4 - Copying build to a temp folder (avoids OneDrive "pending")...
set "NETLIFY_OUT=%LOCALAPPDATA%\Temp\StormPath2-Netlify"
if exist "%NETLIFY_OUT%" rmdir /s /q "%NETLIFY_OUT%"
mkdir "%NETLIFY_OUT%" 2>nul
robocopy "%~dp0dist" "%NETLIFY_OUT%" /E /NFL /NDL /NJH /NJS /NC /NS
if errorlevel 8 (
    echo  robocopy failed — open the dist folder inside this project instead.
    set "NETLIFY_OUT=%~dp0dist"
) else (
    echo  OK: copy is under Local AppData ^(not synced by OneDrive^).
)

echo.
echo  Step 4/4 - Pre-flight checklist
findstr /C:"api.tomorrow.io" "%NETLIFY_OUT%\_headers" >nul
if errorlevel 1 (
    echo  ERROR: _headers in deploy folder is missing api.tomorrow.io
    pause
    exit /b 1
)
if not exist "%NETLIFY_OUT%\icons\icon-192.png" (
    echo  ERROR: icons\icon-192.png missing from deploy folder
    pause
    exit /b 1
)
if not exist "%NETLIFY_OUT%\_deploy-check.txt" (
    echo  ERROR: _deploy-check.txt missing — run build:netlify again
    pause
    exit /b 1
)

echo.
echo  ------------------------------------------------------------
echo   READY TO DEPLOY
echo.
echo   1. Netlify - site stormpath2 - Deploys - drag THIS folder:
echo      %NETLIFY_OUT%
echo.
echo   2. After deploy, verify in your browser:
echo      https://stormpath2.netlify.app/_deploy-check.txt
echo      ^(must show csp_tomorrow_io=yes^)
echo.
echo   3. Hard-refresh the app ^(Ctrl+Shift+R^) and check the console.
echo.
echo   If CSP errors persist AFTER _deploy-check.txt is correct:
echo   Netlify - stormpath2 - Site configuration - HTTP headers
echo   Remove any Content-Security-Policy set in the dashboard
echo   ^(dashboard headers override _headers from your upload^).
echo.
echo   Do NOT use an old Temp folder from a previous run.
echo  ------------------------------------------------------------
echo.
explorer "%NETLIFY_OUT%"
pause
