@echo off
cd /d "%~dp0"
if not exist "node_modules\" (
  echo Installing home-api dependencies...
  call npm install
)
echo Starting StormPath home-api...
call npm start
pause
