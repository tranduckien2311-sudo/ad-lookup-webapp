@echo off
start "" "http://localhost:8085/"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1" -Port 8085
