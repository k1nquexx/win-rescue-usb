@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".\node_modules\electron\dist\electron.exe" (
  echo [!] Зависимости не установлены. Выполняется npm install...
  call npm.cmd install
  if exist ".\node_modules\esbuild\install.js" node ".\node_modules\esbuild\install.js"
  if exist ".\node_modules\electron\install.js" node ".\node_modules\electron\install.js"
)

if not exist ".\dist\index.html" (
  echo [!] Сборка интерфейса dist не найдена. Выполняется npm run build...
  call npm.cmd run build
)

echo Запуск графического мастера Rescue USB (Electron)...
".\node_modules\electron\dist\electron.exe" .
