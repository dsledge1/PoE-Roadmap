@echo off
rem One-time setup for the PoE voice companion. Creates a private Python venv in this folder.
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py -3.10) || (set PY=python)
echo Creating virtual environment...
%PY% -m venv .venv || goto :fail
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt || goto :fail
echo Downloading Whisper models (about 600 MB, one time)...
python companion.py --download-models || goto :fail
echo Checking GPU and microphone...
python companion.py --check
echo.
echo Setup done. Double-click run.bat to start.
pause
exit /b 0
:fail
echo Setup failed. Scroll up for the error.
pause
exit /b 1
