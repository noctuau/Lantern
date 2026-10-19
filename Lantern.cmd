@echo off
cd /d "%~dp0"
if not exist dist-electron\main.js call npm run build
start "" /b npx electron .
