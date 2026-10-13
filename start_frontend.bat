@echo off
REM Run from the project root after installing Node.js and frontend packages.
cd /d "%~dp0frontend"
if not exist "node_modules" (
  echo Installing React frontend dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Install Node.js LTS and retry.
    pause
    exit /b 1
  )
)
echo Starting LeopardWatch frontend at http://127.0.0.1:5173
call npm run dev
pause
