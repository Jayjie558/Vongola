@echo off
setlocal
cd /d "%~dp0"

netstat -ano | findstr ":8741" | findstr "LISTENING" >nul
if errorlevel 1 (
  start "GloveAR Server" /min cmd /c "node ""%~dp0server.js"""
  timeout /t 1 /nobreak >nul
)

start "" "http://127.0.0.1:8741/"
endlocal
