#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Интеграция кастомного меню Rescue USB в загрузочный образ sources\boot.wim на флешке Windows 11.
.DESCRIPTION
  Скрипт монтирует индекс 2 (Microsoft Windows Setup) файла boot.wim через DISM,
  прописывает автозапуск графического мастера в X:\Windows\System32\startnet.cmd
  и копирует сгенерированный комплект (autounattend.xml + $OEM$ + RescueUSB) на флешку.
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

Write-Host "1. Копирование файлов конфигурации (autounattend.xml, `$OEM`$, RescueUSB) на флешку $UsbRoot..." -ForegroundColor Cyan
if (Test-Path $ExportDir) {
  Copy-Item -Path "$ExportDir\*" -Destination $UsbRoot -Recurse -Force
}

Write-Host "2. Монтирование $BootWim (Index 2) в $MountDir..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $MountDir -Force | Out-Null
dism /Mount-Image /ImageFile:"$BootWim" /Index:2 /MountDir:"$MountDir"

try {
  $StartnetPath = Join-Path $MountDir "Windows\System32\startnet.cmd"
  $StartnetSource = Join-Path $ExportDir "RescueUSB\startnet.cmd"
  if (Test-Path $StartnetSource) {
    Write-Host "3. Обновление Windows\System32\startnet.cmd внутри boot.wim..." -ForegroundColor Cyan
    Copy-Item $StartnetSource $StartnetPath -Force
  }
} finally {
  Write-Host "4. Сохранение изменений и размонтирование boot.wim..." -ForegroundColor Cyan
  dism /Unmount-Image /MountDir:"$MountDir" /Commit
}

Write-Host "Готово! Загрузочная флешка-спаситель на диске $UsbRoot успешно подготовлена." -ForegroundColor Green
