@echo off
rem Starts the voice companion and opens the tracker at http://127.0.0.1:8765/
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (echo Run setup.bat first. & pause & exit /b 1)
title PoE voice companion
.venv\Scripts\python.exe companion.py %*
pause
