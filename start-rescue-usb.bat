@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".\node_modules\electron\dist\electron.exe" (
  echo [!] Зависимости не установлены. Выполняется npm install...
  call npm.cmd install
  if errorlevel 1 (
    echo [ОШИБКА] Не удалось установить зависимости через npm install!
    pause
    exit /b 1
  )
  if exist ".\node_modules\esbuild\install.js" node ".\node_modules\esbuild\install.js"
  if exist ".\node_modules\electron\install.js" node ".\node_modules\electron\install.js"
)

if not exist ".\dist\index.html" (
  echo [!] Сборка интерфейса dist не найдена. Выполняется npm run build...
  call npm.cmd run build
  if errorlevel 1 (
    echo [ОШИБКА] Сборка интерфейса завершилась с ошибкой!
    pause
    exit /b 1
  )
)

echo Запуск графического мастера Rescue USB (Electron)...
".\node_modules\electron\dist\electron.exe" .
if errorlevel 1 (
  echo [ОШИБКА] Приложение завершилось с кодом ошибки %ERRORLEVEL%.
  pause
  exit /b %ERRORLEVEL%
)
