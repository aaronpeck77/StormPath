@echo off
title Build website folder for Netlify
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
echo  Step 1/3 - Installing dependencies (first time can take a minute)...
call npm install
if errorlevel 1 (
    echo.
    echo  Something went wrong. Copy the text above and ask for help.
    pause
    exit /b 1
)

echo.
echo  Step 2/3 - Building the website into the "dist" folder...
call npm run build
if errorlevel 1 (
    echo.
    echo  Build failed. Copy the text above and ask for help.
    pause
    exit /b 1
)

echo.
echo  Step 3/4 - Copying build to a temp folder (avoids OneDrive "pending")...
set "NETLIFY_OUT=%LOCALAPPDATA%\Temp\RouteCommandCenter-Netlify"
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
echo  Step 4/4 - Done.
echo.
echo  ------------------------------------------------------------
echo   NEXT: File Explorer opens the folder to use for Netlify Drop.
echo.
echo   USE THIS FOLDER if OneDrive shows "sync pending" on \dist:
echo   %NETLIFY_OUT%
echo.
echo   Your project \dist is still here for local checks:
echo   %~dp0dist
echo.
echo   Why pending? OneDrive re-uploads dist after every build; temp is faster.
echo  ------------------------------------------------------------
echo.
explorer "%NETLIFY_OUT%"
pause
