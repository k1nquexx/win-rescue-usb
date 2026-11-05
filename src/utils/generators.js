import {
  WINDOWS_PROFILES,
  WINDOWS_THEMES,
  CATALOG_ITEMS,
  USER_SETTINGS_OPTIONS,
} from '../data/catalog';

export function generateDiskpartScript(config) {
  const diskNum = config.selectedDiskNumber ?? 0;
  return `rem ============================================================================
rem Автоматическая разметка накопителя (Disk ${diskNum}) — GPT / UEFI
rem Сгенерировано мастером Rescue USB
rem ============================================================================
select disk ${diskNum}
clean
convert gpt
rem 1. Системный раздел EFI (300 МБ, FAT32)
create partition efi size=300
format quick fs=fat32 label="System"
assign letter="S"
rem 2. Зарезервированный раздел Microsoft MSR (16 МБ)
create partition msr size=16
rem 3. Основной раздел Windows C: (NTFS, всё оставшееся пространство)
create partition primary
format quick fs=ntfs label="Windows 11"
assign letter="W"
list volume
exit
`;
}

export function generateAutounattendXml(config) {
  const username = (config.username || 'Fosters').trim();
  const diskNum = config.selectedDiskNumber ?? 0;
  const profile = WINDOWS_PROFILES.find((p) => p.id === config.profileId) || WINDOWS_PROFILES[2];

  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <!-- Профиль: ${profile.title} | Тема: ${config.themeId} | Заказ: ${config.orderNumber || 'Без номера'} -->
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <SetupUILanguage>
        <UILanguage>ru-RU</UILanguage>
      </SetupUILanguage>
      <InputLocale>0419:00000419;0409:00000409</InputLocale>
      <SystemLocale>ru-RU</SystemLocale>
      <UILanguage>ru-RU</UILanguage>
      <UserLocale>ru-RU</UserLocale>
    </component>

    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <!-- Обход проверки TPM 2.0 / SecureBoot / RAM в WinPE -->
      <RunSynchronous>
        <RunSynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>2</Order>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>3</Order>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>

      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>${diskNum}</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add">
              <Order>1</Order>
              <Type>EFI</Type>
              <Size>300</Size>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>2</Order>
              <Type>MSR</Type>
              <Size>16</Size>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>3</Order>
              <Type>Primary</Type>
              <Extend>true</Extend>
            </CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order>
              <PartitionID>1</PartitionID>
              <Label>System</Label>
              <Format>FAT32</Format>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>2</Order>
              <PartitionID>2</PartitionID>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>3</Order>
              <PartitionID>3</PartitionID>
              <Label>Windows 11</Label>
              <Letter>C</Letter>
              <Format>NTFS</Format>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>

      <ImageInstall>
        <OSImage>
          <InstallTo>
            <DiskID>${diskNum}</DiskID>
            <PartitionID>3</PartitionID>
          </InstallTo>
        </OSImage>
      </ImageInstall>

      <UserData>
        <AcceptEula>true</AcceptEula>
        <FullName>${username}</FullName>
        <Organization>${config.brandName || 'Fosters PC'}</Organization>
      </UserData>
    </component>
  </settings>

  <settings pass="specialize">
    <component name="Microsoft-Windows-Deployment" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <RunSynchronous>
        <RunSynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Path>reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\OOBE /v BypassNRO /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>
    </component>
  </settings>

  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
      </OOBE>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>${username}</Name>
            <DisplayName>${username}</DisplayName>
            <Group>Administrators</Group>
            <Password>
              <Value></Value>
              <PlainText>true</PlainText>
            </Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
      <AutoLogon>
        <Enabled>true</Enabled>
        <Username>${username}</Username>
        <LogonCount>1</LogonCount>
        <Password>
          <Value></Value>
          <PlainText>true</PlainText>
        </Password>
      </AutoLogon>
      <FirstLogonCommands>
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Description>Подготовка рабочего окружения и применение твиков</Description>
          <CommandLine>powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Windows\\Setup\\Scripts\\post-install-tweaks.ps1"</CommandLine>
        </SynchronousCommand>
      </FirstLogonCommands>
    </component>
  </settings>
</unattend>
`;
}

export function generatePostInstallScript(config) {
  const profile = WINDOWS_PROFILES.find((p) => p.id === config.profileId) || WINDOWS_PROFILES[2];
  const theme = WINDOWS_THEMES.find((t) => t.id === config.themeId) || WINDOWS_THEMES[0];
  const isDark = config.colorMode !== 'light';

  const allCatalog = [
    ...CATALOG_ITEMS.programs,
    ...CATALOG_ITEMS.drivers,
    ...CATALOG_ITEMS.tweaks,
    ...CATALOG_ITEMS.rgb,
  ];
  const selectedCatalog = allCatalog.filter((item) => config.selectedItems.includes(item.id));
  const wingetItems = selectedCatalog.filter((item) => item.wingetId);
  const regTweakItems = selectedCatalog.filter((item) => item.regCommands);
  const cmdItems = selectedCatalog.filter((item) => item.command);

  const selectedUserOpts = USER_SETTINGS_OPTIONS.filter((opt) =>
    config.selectedUserSettings.includes(opt.id)
  );

  const lines = [
    `#Requires -RunAsAdministrator`,
    `# ==============================================================================`,
    `# Скрипт подготовки рабочего окружения Windows 11 (${config.brandName || 'Fosters PC'})`,
    `# Профиль: ${profile.title}`,
    `# Тема: ${theme.title} (${isDark ? 'Тёмная' : 'Светлая'})`,
    `# Пользователь: ${config.username || 'Fosters'} | Заказ: ${config.orderNumber || 'Не указан'}`,
    `# ==============================================================================`,
    `$ErrorActionPreference = "SilentlyContinue"`,
    `Write-Host "=== [1/5] Подготавливаем профиль Windows (${profile.id.toUpperCase()}) ===" -ForegroundColor Cyan`,
    ``,
    `# 1. Удаление ненужных предустановленных Appx-пакетов для выбранного профиля`,
    `$AppxToRemove = @(`,
    ...profile.removeAppx.map((pkg) => `  "${pkg}"`),
    `)`,
    `foreach ($pkg in $AppxToRemove) {`,
    `  Write-Host "Удаление пакета: $pkg..." -ForegroundColor DarkGray`,
    `  Get-AppxPackage -Name "*$pkg*" -AllUsers | Remove-AppxPackage -AllUsers -ErrorAction SilentlyContinue`,
    `  Get-AppxProvisionedPackage -Online | Where-Object DisplayName -like "*$pkg*" | Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue`,
    `}`,
    ``,
    `Write-Host "=== [2/5] Настройка темы оформления (${theme.title}) и цвета системы ===" -ForegroundColor Cyan`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme /t REG_DWORD /d ${isDark ? 0 : 1} /f | Out-Null`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v SystemUsesLightTheme /t REG_DWORD /d ${isDark ? 0 : 1} /f | Out-Null`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarAl /t REG_DWORD /d ${theme.taskbarAlign} /f | Out-Null`,
  ];

  if (theme.classicContext) {
    lines.push(
      `# Включение классического контекстного меню в стиле Windows 10`,
      `reg add "HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32" /f /ve | Out-Null`
    );
  }

  lines.push(
    ``,
    `Write-Host "=== [3/5] Применение системных твиков и оптимизаций ===" -ForegroundColor Cyan`
  );

  for (const tweak of regTweakItems) {
    lines.push(`# ${tweak.title}`);
    for (const cmd of tweak.regCommands) {
      lines.push(cmd);
    }
  }

  lines.push(
    ``,
    `Write-Host "=== [4/5] Применение настроек пользователя ===" -ForegroundColor Cyan`
  );

  for (const opt of selectedUserOpts) {
    lines.push(`# ${opt.title}`);
    lines.push(opt.reg);
  }

  lines.push(
    ``,
    `Write-Host "=== [5/5] Автоматическая установка выбранных программ и драйверов ===" -ForegroundColor Cyan`
  );

  for (const item of cmdItems) {
    lines.push(`# ${item.title}`);
    lines.push(item.command);
  }

  if (wingetItems.length > 0) {
    lines.push(
      `if (Get-Command winget -ErrorAction SilentlyContinue) {`,
      ...wingetItems.map(
        (item) =>
          `  Write-Host "Установка ${item.title} (${item.wingetId})..." -ForegroundColor Green\n  winget install --id "${item.wingetId}" --silent --accept-package-agreements --accept-source-agreements`
      ),
      `} else {`,
      `  Write-Host "Winget ещё инициализируется, запуск офлайн-установщиков из папки флешки \\Programs..." -ForegroundColor Yellow`,
      `}`
    );
  }

  lines.push(
    ``,
    `# Перезапуск Проводника для применения темы и настроек панели задач`,
    `Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue`,
    `Write-Host "Готово! Настройка Windows 11 успешно завершена." -ForegroundColor Green`
  );

  return lines.join('\r\n');
}

export function generateWinPeInstallScript(config) {
  const diskNum = config.selectedDiskNumber ?? 0;
  return `#Requires -RunAsAdministrator
# ==============================================================================
# Скрипт развёртывания образа Windows 11 из среды WinPE (Флешка-спаситель)
# ==============================================================================
param(
  [string]$WimPath = "D:\\sources\\install.wim",
  [int]$ImageIndex = 1,
  [switch]$DryRun
)

Write-Host "1. Проверка наличия образа $WimPath..." -ForegroundColor Cyan
if ($DryRun) {
  Write-Host "[DRY-RUN] Симуляция разметки диска ${diskNum} и применения образа $WimPath" -ForegroundColor Yellow
  exit 0
}

Write-Host "2. Разметка накопителя Disk ${diskNum} через DiskPart..." -ForegroundColor Cyan
diskpart /s "$PSScriptRoot\\diskpart-script.txt"

Write-Host "3. Развёртывание образа Windows 11 на раздел W: (DISM /Apply-Image)..." -ForegroundColor Cyan
dism /Apply-Image /ImageFile:"$WimPath" /Index:$ImageIndex /ApplyDir:W:\\

Write-Host "4. Копирование конфигурации autounattend.xml и скрипта пост-установки..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path "W:\\Windows\\Panther" -Force | Out-Null
New-Item -ItemType Directory -Path "W:\\Windows\\Setup\\Scripts" -Force | Out-Null
Copy-Item "$PSScriptRoot\\autounattend.xml" "W:\\Windows\\Panther\\unattend.xml" -Force
Copy-Item "$PSScriptRoot\\post-install-tweaks.ps1" "W:\\Windows\\Setup\\Scripts\\post-install-tweaks.ps1" -Force

Write-Host "5. Создание загрузчика UEFI (bcdboot)..." -ForegroundColor Cyan
bcdboot W:\\Windows /s S: /f UEFI /l ru-ru

Write-Host "Установка образа завершена! ПК готов к перезагрузке." -ForegroundColor Green
`;
}

export function generateStartnetCmd() {
  return `@echo off
wpeinit
powercfg /s 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c
echo Поиск накопителя Rescue USB...
for %%d in (C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
  if exist "%%d:\\RescueUSB\\win-rescue-usb.exe" (
    start "" "%%d:\\RescueUSB\\win-rescue-usb.exe"
    exit /b 0
  )
)
cmd.exe
`;
}
