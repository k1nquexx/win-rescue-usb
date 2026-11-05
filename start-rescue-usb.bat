@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск графического мастера Rescue USB (Electron)...
".\node_modules\electron\dist\electron.exe" .
