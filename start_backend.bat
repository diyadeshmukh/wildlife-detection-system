@echo off
REM Execute this file from the main leopard-detection-system folder.
REM Assumes Anaconda/Miniconda and the leopard_env environment are installed.
cd /d "%~dp0"
call conda activate leopard_env
if errorlevel 1 (
    echo ERROR: Could not activate leopard_env. Open Anaconda Prompt and try again.
    pause
    exit /b 1
)
echo Starting Leopard Detection API...
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause
