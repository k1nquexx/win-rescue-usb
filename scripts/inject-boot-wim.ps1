#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Интеграция кастомного меню Rescue USB в загрузочный образ sources\boot.wim на флешке Windows 11.
.DESCRIPTION
  Скрипт проверяет корректность буквы накопителя, наличие экспортированного комплекта (startnet.cmd),
  копирует портативный win-rescue-usb.exe (если он собран в release\ или dist\), очищает точку монтирования,
  монтирует индекс Setup (2, либо 1 для образов с одним индексом) файла boot.wim через DISM, обновляет X:\Windows\System32\startnet.cmd и безопасно
  сохраняет образ (/Commit) либо откатывает изменения (/Discard) при сбое.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$UsbDriveLetter, # Например: "E:" или "E"
  [string]$MountDir = "C:\WinPE_Mount"
)

$ErrorActionPreference = "Stop"

# [V2-BUG-04] Нормализация и валидация буквы USB-накопителя
$CleanLetter = $UsbDriveLetter.Trim().TrimEnd('\').TrimEnd(':')
if ($CleanLetter -notmatch '^[A-Za-z]$') {
  throw "Некорректная буква диска: '$UsbDriveLetter'. Укажите букву от D до Z (например, E: или E)."
}
if ($CleanLetter -match '^[Cc]$') {
  throw "Операция заблокирована: диск C: является системным!"
}

$UsbRoot = "${CleanLetter}:\"
$BootWim = Join-Path $UsbRoot "sources\boot.wim"
$ExportDir = Join-Path $PSScriptRoot "..\usb-export"
$StartnetSource = Join-Path $ExportDir "RescueUSB\startnet.cmd"

if (-not (Test-Path -LiteralPath $BootWim)) {
  Write-Error "Файл $BootWim не найден! Убедитесь, что на флешке $UsbRoot записан образ Windows 11."
  exit 1
}

# Проверяем наличие экспортированных файлов ДО монтирования boot.wim
if (-not (Test-Path -LiteralPath $StartnetSource)) {
  throw "Исходный файл $StartnetSource не найден! Сначала выполните экспорт комплекта в приложении."
}

# [V3-BUG-03] Автоматическое копирование собранного портативного win-rescue-usb.exe из release\ или dist\
foreach ($exeCandidate in @(
  (Join-Path $PSScriptRoot "..\release\win-rescue-usb.exe"),
  (Join-Path $PSScriptRoot "..\dist\win-rescue-usb.exe")
)) {
  if (Test-Path -LiteralPath $exeCandidate) {
    Write-Host "Найден портативный исполняемый файл $exeCandidate -> копирование в RescueUSB\win-rescue-usb.exe..." -ForegroundColor Cyan
    Copy-Item -LiteralPath $exeCandidate -Destination (Join-Path $ExportDir "RescueUSB\win-rescue-usb.exe") -Force
    break
  }
}

Write-Host "1. Копирование файлов конфигурации (autounattend.xml, `$OEM`$, `$WinPEDriver`$, RescueUSB) на флешку $UsbRoot..." -ForegroundColor Cyan
Copy-Item -Path "$ExportDir\*" -Destination $UsbRoot -Recurse -Force

Write-Host "2. Очистка точек монтирования и подготовка пустой папки $MountDir..." -ForegroundColor Cyan
dism /Cleanup-Wim | Out-Null

# [V3-BUG-06] Гарантируем, что папка точки монтирования пуста (предотвращение ошибки DISM 0x80070091)
if (Test-Path -LiteralPath $MountDir) {
  Get-ChildItem -LiteralPath $MountDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
} else {
  New-Item -ItemType Directory -Path $MountDir -Force | Out-Null
}

# [BUG-03] Динамический выбор индекса: Setup (2), если в образе их >= 2, иначе единственный индекс 1
$WimInfo = @(Get-WindowsImage -ImagePath $BootWim)
if ($WimInfo.Count -eq 0) { throw "В образе $BootWim не найдено ни одного индекса." }
$TargetIndex = if ($WimInfo.Count -ge 2) { 2 } else { 1 }
Write-Host "Используется индекс образа: $TargetIndex (всего индексов: $($WimInfo.Count))" -ForegroundColor Cyan

# [RES-03] Флаг монтирования + try/finally: finally выполняется и при Ctrl+C, в отличие от catch
$script:Mounted = $false
try {
  dism /Mount-Image /ImageFile:"$BootWim" /Index:$TargetIndex /MountDir:"$MountDir"
  if ($LASTEXITCODE -ne 0) {
    throw "Не удалось смонтировать образ $BootWim (код ошибки DISM: $LASTEXITCODE)."
  }
  $script:Mounted = $true

  $StartnetPath = Join-Path $MountDir "Windows\System32\startnet.cmd"

  Write-Host "3. Обновление Windows\System32\startnet.cmd внутри boot.wim..." -ForegroundColor Cyan
  Copy-Item -LiteralPath $StartnetSource -Destination $StartnetPath -Force

  Write-Host "4. Сохранение изменений и размонтирование boot.wim (/Commit)..." -ForegroundColor Cyan
  dism /Unmount-Image /MountDir:"$MountDir" /Commit
  if ($LASTEXITCODE -ne 0) {
    throw "Ошибка при сохранении образа boot.wim (код ошибки DISM: $LASTEXITCODE)."
  }
  $script:Mounted = $false
} finally {
  if ($script:Mounted) {
    Write-Warning "Сбой или прерывание! Откат изменений образа boot.wim (/Discard) и сброс точек монтирования..."
    dism /Unmount-Image /MountDir:"$MountDir" /Discard 2>$null | Out-Null
    dism /Cleanup-Wim 2>$null | Out-Null
  }
}

Write-Host "Готово! Загрузочная флешка-спаситель на диске $UsbRoot успешно подготовлена." -ForegroundColor Green
