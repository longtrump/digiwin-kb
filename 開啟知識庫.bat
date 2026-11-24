@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto openfile
start "" "http://127.0.0.1:41731/"
node "%~dp0serve.mjs" 41731
goto end
:openfile
start "" "%~dp0index.html"
:end
