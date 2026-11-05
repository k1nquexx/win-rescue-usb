#!/usr/bin/env pwsh
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Интеграция кастомного меню Rescue USB в загрузочный образ sources\boot.wim на флешке Windows 11.
.DESCRIPTION
  Скрипт монтирует индекс 2 (Microsoft Windows Setup) файла boot.wim через DISM,
  прописывает автозапуск графического мастера в X:\Windows\System32\startnet.cmd,
  при успехе фиксирует изменения (/Commit), а при любой ошибке выполняет безопасный откат (/Discard).
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$UsbDriveLetter, # Например: "E:"
  [string]$MountDir = "C:\WinPE_Mount"
)

$ErrorActionPreference = "Stop"
$UsbRoot = $UsbDriveLetter.TrimEnd('\') + "\"
$BootWim = Join-Path $UsbRoot "sources\boot.wim"
$ExportDir = Join-Path $PSScriptRoot "..\usb-export"

if (-not (Test-Path $BootWim)) {
  Write-Error "Файл $BootWim не найден! Убедитесь, что на флешке записан образ Windows 11."
  exit 1
}

Write-Host "1. Копирование файлов конфигурации (autounattend.xml, `$OEM`$, `$WinPEDriver`$, RescueUSB) на флешку $UsbRoot..." -ForegroundColor Cyan
if (Test-Path $ExportDir) {
  Copy-Item -Path "$ExportDir\*" -Destination $UsbRoot -Recurse -Force
} else {
  throw "Папка экспорта $ExportDir не найдена! Сначала экспортируйте комплект в приложении."
}

Write-Host "2. Очистка зависших точек монтирования и монтирование $BootWim (Index 2) в $MountDir..." -ForegroundColor Cyan
dism /Cleanup-Wim | Out-Null
New-Item -ItemType Directory -Path $MountDir -Force | Out-Null

dism /Mount-Image /ImageFile:"$BootWim" /Index:2 /MountDir:"$MountDir"
if ($LASTEXITCODE -ne 0) {
  throw "Не удалось смонтировать образ $BootWim (код ошибки DISM: $LASTEXITCODE)."
}

try {
  $StartnetPath = Join-Path $MountDir "Windows\System32\startnet.cmd"
  $StartnetSource = Join-Path $ExportDir "RescueUSB\startnet.cmd"
  if (-not (Test-Path $StartnetSource)) {
    throw "Исходный файл $StartnetSource не найден! Сначала выполните экспорт в приложении."
  }

  Write-Host "3. Обновление Windows\System32\startnet.cmd внутри boot.wim..." -ForegroundColor Cyan
  Copy-Item $StartnetSource $StartnetPath -Force

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
