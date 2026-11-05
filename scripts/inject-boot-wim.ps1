#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Интеграция кастомного меню Rescue USB в загрузочный образ sources\boot.wim на флешке Windows 11.
.DESCRIPTION
  Скрипт проверяет корректность буквы накопителя, наличие экспортированного комплекта (startnet.cmd),
  копирует портативный win-rescue-usb.exe (если он собран в dist\), монтирует индекс 2 файла boot.wim
  через DISM, обновляет X:\Windows\System32\startnet.cmd и безопасно сохраняет образ (/Commit) либо
  откатывает изменения (/Discard) при сбое.
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

# Автоматическое копирование собранного портативного win-rescue-usb.exe в папку экспорта
foreach ($exeCandidate in @(
  (Join-Path $PSScriptRoot "..\dist\win-rescue-usb.exe"),
  (Join-Path $PSScriptRoot "..\release\win-rescue-usb.exe")
)) {
  if (Test-Path -LiteralPath $exeCandidate) {
    Write-Host "Найден портативный исполняемый файл $exeCandidate -> копирование в RescueUSB\win-rescue-usb.exe..." -ForegroundColor Cyan
    Copy-Item -LiteralPath $exeCandidate -Destination (Join-Path $ExportDir "RescueUSB\win-rescue-usb.exe") -Force
    break
  }
}

Write-Host "1. Копирование файлов конфигурации (autounattend.xml, `$OEM`$, `$WinPEDriver`$, RescueUSB) на флешку $UsbRoot..." -ForegroundColor Cyan
Copy-Item -Path "$ExportDir\*" -Destination $UsbRoot -Recurse -Force

Write-Host "2. Очистка зависших точек монтирования и монтирование $BootWim (Index 2) в $MountDir..." -ForegroundColor Cyan
dism /Cleanup-Wim | Out-Null
New-Item -ItemType Directory -Path $MountDir -Force | Out-Null

dism /Mount-Image /ImageFile:"$BootWim" /Index:2 /MountDir:"$MountDir"
if ($LASTEXITCODE -ne 0) {
  throw "Не удалось смонтировать образ $BootWim (код ошибки DISM: $LASTEXITCODE)."
}

try {
  $StartnetPath = Join-Path $MountDir "Windows\System32\startnet.cmd"

  Write-Host "3. Обновление Windows\System32\startnet.cmd внутри boot.wim..." -ForegroundColor Cyan
  Copy-Item -LiteralPath $StartnetSource -Destination $StartnetPath -Force

  Write-Host "4. Сохранение изменений и размонтирование boot.wim (/Commit)..." -ForegroundColor Cyan
  dism /Unmount-Image /MountDir:"$MountDir" /Commit
  if ($LASTEXITCODE -ne 0) {
    throw "Ошибка при сохранении образа boot.wim (код ошибки DISM: $LASTEXITCODE)."
  }
} catch {
  Write-Warning "Сбой операции! Выполняется откат изменений образа boot.wim (/Discard)..."
  dism /Unmount-Image /MountDir:"$MountDir" /Discard | Out-Null
  dism /Cleanup-Wim | Out-Null
  throw $_
}

Write-Host "Готово! Загрузочная флешка-спаситель на диске $UsbRoot успешно подготовлена." -ForegroundColor Green
