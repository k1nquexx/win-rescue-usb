import {
  WINDOWS_PROFILES,
  WINDOWS_THEMES,
  CATALOG_ITEMS,
  USER_SETTINGS_OPTIONS,
} from '../data/catalog.js';

const RESERVED_WINDOWS_NAMES = new Set([
  'administrator',
  'администратор',
  'guest',
  'гость',
  'defaultaccount',
  'wdagutilityaccount',
  'system',
  'local service',
  'network service',
  'none',
  'все',
  'everyone',
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// [V2-BUG-06] Filter illegal chars, trailing dots, and reserved Windows account/device names
export function sanitizeWindowsUsername(rawName) {
  const cleaned = String(rawName || 'Fosters')
    .replace(/["/\\[\]:;|=,+*?<>@\r\n\0]/g, '')
    .replace(/\.+$/g, '')
    .trim()
    .slice(0, 20);
  if (!cleaned || RESERVED_WINDOWS_NAMES.has(cleaned.toLowerCase())) {
    return 'Fosters';
  }
  return cleaned;
}

export function sanitizePsComment(str) {
  return String(str ?? '')
    .replace(/[\r\n\0]/g, ' ')
    .trim();
}

export function escapePsSingleQuoted(str) {
  return sanitizePsComment(str).replace(/'/g, "''");
}

export function sanitizeDiskNumber(num) {
  // [BUG-01] Никакого неявного fallback на Disk 0: диск должен быть выбран явно
  if (num === null || num === undefined || (typeof num === 'string' && num.trim() === '')) {
    throw new Error('Критическая ошибка: Целевой диск для развертывания не выбран.');
  }
  const parsed = Number(num);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Недопустимый идентификатор накопителя: "${num}".`);
  }
  return parsed;
}

// [BUG-01] Явный режим разметки: полная переразметка диска или установка в существующий раздел
export function sanitizePartitionPlan(config) {
  if (config.partitionMode === 'existing_partition') {
    const id = Number(config.selectedPartitionId);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error('Критическая ошибка: не выбран целевой раздел для установки.');
    }
    return { mode: 'existing_partition', partId: id };
  }
  return { mode: 'wipe_gpt', partId: 3 };
}

export function generateDiskpartScript(config) {
  const diskNum = sanitizeDiskNumber(config.selectedDiskNumber);
  const plan = sanitizePartitionPlan(config);
  if (plan.mode === 'existing_partition') {
    return `rem ============================================================================
rem Установка в существующий раздел (Disk ${diskNum}, Partition ${plan.partId}) — остальные разделы не затрагиваются
rem Сгенерировано мастером Rescue USB
rem ============================================================================
select disk ${diskNum}
select partition ${plan.partId}
format quick fs=ntfs label="Windows 11"
remove all noerr
assign letter="W"
list volume
exit
`;
  }
  return `rem ============================================================================
rem Автоматическая разметка накопителя (Disk ${diskNum}) — GPT / UEFI (ПОЛНАЯ ПЕРЕРАЗМЕТКА)
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
  const cleanUser = sanitizeWindowsUsername(config.username);
  const username = escapeXml(cleanUser);
  const brandName = escapeXml(sanitizePsComment(config.brandName || 'Fosters PC') || 'Fosters PC');
  const safeOrder = escapeXml(
    sanitizePsComment(config.orderNumber || 'Без номера').replace(/--/g, '-')
  );
  const safeThemeId = escapeXml(sanitizePsComment(config.themeId || 'win11').replace(/--/g, '-'));
  const diskNum = sanitizeDiskNumber(config.selectedDiskNumber);
  const plan = sanitizePartitionPlan(config);
  const installPartId = plan.partId;
  // [BUG-03] Явный выбор редакции (Pro) вместо ручного выбора в Setup / случайного Home под индексом 1
  const imageName = 'Windows 11 Pro';
  const diskConfigXml =
    plan.mode === 'existing_partition'
      ? `      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>${diskNum}</DiskID>
          <WillWipeDisk>false</WillWipeDisk>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order>
              <PartitionID>${plan.partId}</PartitionID>
              <Label>Windows 11</Label>
              <Letter>C</Letter>
              <Format>NTFS</Format>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>`
      : `      <DiskConfiguration>
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
      </DiskConfiguration>`;
  const profile = WINDOWS_PROFILES.find((p) => p.id === config.profileId) || WINDOWS_PROFILES[2];
  const safeProfileTitle = escapeXml(profile.title.replace(/--/g, '-'));

  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <!-- Профиль: ${safeProfileTitle} | Тема: ${safeThemeId} | Заказ: ${safeOrder} -->
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
      <!-- Обход проверки TPM 2.0 / SecureBoot / RAM / CPU / Storage в WinPE -->
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
        <RunSynchronousCommand wcm:action="add">
          <Order>4</Order>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>5</Order>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassStorageCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>

${diskConfigXml}

      <ImageInstall>
        <OSImage>
          <InstallFrom>
            <MetaData wcm:action="add">
              <Key>/IMAGE/NAME</Key>
              <Value>${imageName}</Value>
            </MetaData>
          </InstallFrom>
          <InstallTo>
            <DiskID>${diskNum}</DiskID>
            <PartitionID>${installPartId}</PartitionID>
          </InstallTo>
        </OSImage>
      </ImageInstall>

      <UserData>
        <AcceptEula>true</AcceptEula>
        <FullName>${username}</FullName>
        <Organization>${brandName}</Organization>
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
          <CommandLine>powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path -LiteralPath 'C:\\Windows\\Setup\\Scripts\\post-install-tweaks.ps1') { &amp; 'C:\\Windows\\Setup\\Scripts\\post-install-tweaks.ps1' } else { foreach ($d in (Get-PSDrive -PSProvider FileSystem)) { $p = Join-Path $d.Root 'RescueUSB\\post-install-tweaks.ps1'; if (Test-Path -LiteralPath $p) { &amp; $p; break } } }"</CommandLine>
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

  const safeBrand = sanitizePsComment(config.brandName || 'Fosters PC') || 'Fosters PC';
  const safeUser = sanitizeWindowsUsername(config.username);
  const safeOrder = sanitizePsComment(config.orderNumber || 'Не указан') || 'Не указан';

  const allCatalog = [
    ...CATALOG_ITEMS.programs,
    ...CATALOG_ITEMS.drivers,
    ...CATALOG_ITEMS.tweaks,
    ...CATALOG_ITEMS.rgb,
  ];
  const selectedCatalog = allCatalog.filter((item) => config.selectedItems.includes(item.id));
  const installableItems = selectedCatalog.filter((item) => item.wingetId || item.offlineInstaller);
  const regTweakItems = selectedCatalog.filter((item) => item.regCommands);
  const cmdItems = selectedCatalog.filter((item) => item.command);

  const selectedUserOpts = USER_SETTINGS_OPTIONS.filter((opt) =>
    config.selectedUserSettings.includes(opt.id)
  );

  const lines = [
    `#Requires -RunAsAdministrator`,
    `# ==============================================================================`,
    `# Скрипт подготовки рабочего окружения Windows 11 (${safeBrand})`,
    `# Профиль: ${profile.title}`,
    `# Тема: ${theme.title} (${isDark ? 'Тёмная' : 'Светлая'})`,
    `# Пользователь: ${safeUser} | Заказ: ${safeOrder}`,
    `# ==============================================================================`,
    `# [ERR-01] Ошибки не подавляются глобально; ход выполнения пишется в журнал`,
    `$ErrorActionPreference = "Continue"`,
    `$LogPath = "$env:SystemRoot\\Temp\\RescueUSB_PostInstall.log"`,
    `Start-Transcript -Path $LogPath -Append -ErrorAction SilentlyContinue | Out-Null`,
    ``,
    `# [V2-BUG-10] Единоразовое определение корня загрузочной флешки RescueUSB`,
    `$RescueDrive = Get-PSDrive -PSProvider FileSystem | Where-Object {`,
    `  Test-Path -LiteralPath (Join-Path $_.Root "RescueUSB")`,
    `} | Select-Object -First 1`,
    `$RescueUsbRoot = if ($RescueDrive) { $RescueDrive.Root } else { $null }`,
    ``,
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
  ];

  // Profile-specific service/registry configurations matching catalog descriptions
  if (profile.id === 'light') {
    lines.push(
      `# Оптимизация служб для облегчённого профиля Light (снижение потребления ОЗУ)`,
      `Stop-Service SysMain -Force -ErrorAction SilentlyContinue`,
      `Set-Service SysMain -StartupType Disabled -ErrorAction SilentlyContinue`,
      `Stop-Service DiagTrack -Force -ErrorAction SilentlyContinue`,
      `Set-Service DiagTrack -StartupType Disabled -ErrorAction SilentlyContinue`
    );
  } else if (profile.id === 'gaming') {
    lines.push(
      `# Активация Игрового режима (Game Mode) для профиля Gaming`,
      `reg add "HKCU\\Software\\Microsoft\\GameBar" /v AllowAutoGameMode /t REG_DWORD /d 1 /f | Out-Null`,
      `reg add "HKCU\\Software\\Microsoft\\GameBar" /v AutoGameModeEnabled /t REG_DWORD /d 1 /f | Out-Null`
    );
  }

  lines.push(
    ``,
    `Write-Host "=== [2/5] Настройка темы оформления (${theme.title}), обоев и акцентов ===" -ForegroundColor Cyan`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme /t REG_DWORD /d ${isDark ? 0 : 1} /f | Out-Null`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v SystemUsesLightTheme /t REG_DWORD /d ${isDark ? 0 : 1} /f | Out-Null`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v ColorPrevalence /t REG_DWORD /d ${theme.colorPrevalence ?? 0} /f | Out-Null`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\DWM" /v AccentColor /t REG_DWORD /d ${theme.accentDword || '0xffd47800'} /f | Out-Null`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\DWM" /v ColorPrevalence /t REG_DWORD /d ${theme.colorPrevalence ?? 0} /f | Out-Null`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarAl /t REG_DWORD /d ${theme.taskbarAlign} /f | Out-Null`,
    ``,
    `# [V2-BUG-05] Надёжное применение обоев рабочего стола через Win32 SystemParametersInfo (SPI_SETDESKWALLPAPER)`,
    `Add-Type -TypeDefinition @"`,
    `using System;`,
    `using System.Runtime.InteropServices;`,
    `public class Win32Wallpaper {`,
    `  [DllImport("user32.dll", CharSet = CharSet.Auto)]`,
    `  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);`,
    `}`,
    `"@ -ErrorAction SilentlyContinue`,
    `if ($RescueUsbRoot) {`,
    `  $wpSrc = Join-Path $RescueUsbRoot "RescueUSB\\Themes\\${theme.wallpaperFile || 'win11.bmp'}"`,
    `  if (Test-Path -LiteralPath $wpSrc) {`,
    `    $wpDst = "$env:SystemRoot\\Web\\Wallpaper\\RescueUSB_${theme.wallpaperFile || 'win11.bmp'}"`,
    `    Copy-Item -LiteralPath $wpSrc -Destination $wpDst -Force`,
    `    reg add "HKCU\\Control Panel\\Desktop" /v WallPaper /t REG_SZ /d "$wpDst" /f | Out-Null`,
    `    [Win32Wallpaper]::SystemParametersInfo(0x0014, 0, $wpDst, 0x01 -bor 0x02) | Out-Null`,
    `  }`,
    `}`
  );

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
    if (tweak.id === 'tweak_cpu') {
      const mode = ['auto', 'amd', 'intel'].includes(config.cpuVendorMode)
        ? config.cpuVendorMode
        : 'auto';
      lines.push(`# Режим оптимизации ЦП: ${mode.toUpperCase()}`);
      if (mode === 'auto') {
        lines.push(
          `# [BUG-05] Единоразовый опрос WMI, берём только первый ЦП (многосокетные системы возвращают массив)`,
          `$cpuMfg = [string]((Get-CimInstance Win32_Processor | Select-Object -First 1).Manufacturer)`
        );
      }
      if (mode === 'amd' || mode === 'auto') {
        const cond = mode === 'amd' ? '$true' : '($cpuMfg -match "AMD")';
        lines.push(
          `if (${cond}) {`,
          `  reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\54533251-82be-4824-96c1-47b60b740d00\\0cc5b647-c1df-4637-891a-dec35c318583" /v ValueMax /t REG_DWORD /d 0 /f | Out-Null`,
          `}`
        );
      }
      if (mode === 'intel' || mode === 'auto') {
        const cond = mode === 'intel' ? '$true' : '($cpuMfg -match "Intel")';
        lines.push(
          `if (${cond}) {`,
          `  powercfg -setacvalueindex scheme_current sub_processor HETEROPOLICY 4`,
          `  powercfg -setactive scheme_current`,
          `}`
        );
      }
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
    `Write-Host "=== [5/5] Гибридная установка выбранных программ и драйверов (Offline USB + Winget) ===" -ForegroundColor Cyan`,
    `# [V2-BUG-02] & [V3-BUG-05] Поддержка .msi через msiexec.exe, копирование портативных утилит и проверка ExitCode`,
    `# [ERR-02] Ожидание процесса с таймаутом и принудительным завершением дерева процессов`,
    `function Wait-RescueProcess {`,
    `  param($Proc, [int]$TimeoutSec = 300, [string]$Name = 'пакет')`,
    `  if (-not $Proc) { return $false }`,
    `  $null = $Proc.Handle`,
    `  if (-not $Proc.WaitForExit($TimeoutSec * 1000)) {`,
    `    Write-Warning "  [!] Превышен таймаут ожидания ($TimeoutSec сек) для $Name, принудительное завершение..."`,
    `    & taskkill.exe /PID $Proc.Id /T /F 2>&1 | Out-Null`,
    `    return $false`,
    `  }`,
    `  return ($Proc.ExitCode -eq 0 -or $Proc.ExitCode -eq 3010 -or $Proc.ExitCode -eq 1641)`,
    `}`,
    `# [V2-BUG-02] & [V3-BUG-05] & [SEC-02] & [ERR-02] .msi через msiexec, портативные утилиты, ExitCode, Authenticode и таймауты`,
    `function Install-RescuePackage {`,
    `  param([string]$Title, [string]$WingetId, [string]$OfflineExe, [string]$OfflineArgs)`,
    `  Write-Host "Установка: $Title..." -ForegroundColor Green`,
    `  $installedOffline = $false`,
    `  if ($OfflineExe -and $RescueUsbRoot) {`,
    `    $candidate = Join-Path -Path $RescueUsbRoot -ChildPath "RescueUSB\\Installers\\$OfflineExe"`,
    `    if (Test-Path -LiteralPath $candidate) {`,
    `      $sig = Get-AuthenticodeSignature -LiteralPath $candidate`,
    `      if ($sig.Status -ne 'Valid') {`,
    `        Write-Warning "  [!] Файл $candidate не имеет доверенной цифровой подписи ($($sig.Status)). Офлайн-пакет пропущен."`,
    `      } else {`,
    `        Write-Host "  -> Найден подписанный офлайн-пакет $candidate" -ForegroundColor Cyan`,
    `        if ($candidate -match '\\.msi$') {`,
    `          $msiArgs = ('/i "' + $candidate + '" ' + $OfflineArgs).Trim()`,
    `          $proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -PassThru`,
    `          if (Wait-RescueProcess -Proc $proc -TimeoutSec 300 -Name $OfflineExe) {`,
    `            $installedOffline = $true`,
    `          } else {`,
    `            Write-Host "  [!] MSI-пакет не установлен (код $($proc.ExitCode)), пробуем winget..." -ForegroundColor Yellow`,
    `          }`,
    `        } elseif ([string]::IsNullOrWhiteSpace($OfflineArgs)) {`,
    `          $portableDir = "$env:ProgramFiles\\RescueUSB_Tools"`,
    `          New-Item -ItemType Directory -Path $portableDir -Force | Out-Null`,
    `          $dstFile = Join-Path $portableDir $OfflineExe`,
    `          Copy-Item -LiteralPath $candidate -Destination $dstFile -Force`,
    `          if (Test-Path -LiteralPath $dstFile) {`,
    `            $installedOffline = $true`,
    `            Write-Host "  -> Портативная утилита скопирована в $dstFile" -ForegroundColor Cyan`,
    `          }`,
    `        } else {`,
    `          $proc = Start-Process -FilePath $candidate -ArgumentList $OfflineArgs -PassThru`,
    `          if (Wait-RescueProcess -Proc $proc -TimeoutSec 300 -Name $OfflineExe) {`,
    `            $installedOffline = $true`,
    `          } else {`,
    `            Write-Host "  [!] Офлайн-пакет не установлен (код $($proc.ExitCode)), пробуем winget..." -ForegroundColor Yellow`,
    `          }`,
    `        }`,
    `      }`,
    `    }`,
    `  }`,
    `  if (-not $installedOffline -and $WingetId) {`,
    `    if (Get-Command winget -ErrorAction SilentlyContinue) {`,
    `      $wg = Start-Process -FilePath "winget" -ArgumentList @("install", "--id", $WingetId, "--silent", "--accept-package-agreements", "--accept-source-agreements") -PassThru -NoNewWindow`,
    `      if (-not (Wait-RescueProcess -Proc $wg -TimeoutSec 600 -Name "winget $WingetId")) {`,
    `        Write-Host "  [!] winget не завершил установку $WingetId успешно." -ForegroundColor Yellow`,
    `      }`,
    `    } else {`,
    `      Write-Host "  [!] Winget недоступен и подписанный офлайн-пакет $OfflineExe не установлен." -ForegroundColor Yellow`,
    `    }`,
    `  }`,
    `}`
  );

  for (const item of cmdItems) {
    lines.push(`# ${item.title}`);
    lines.push(item.command);
  }

  for (const item of installableItems) {
    const safeTitle = escapePsSingleQuoted(item.title);
    const safeWinget = escapePsSingleQuoted(item.wingetId || '');
    const safeOffline = escapePsSingleQuoted(item.offlineInstaller || '');
    const safeArgs = escapePsSingleQuoted(item.offlineArgs || '');
    lines.push(
      `Install-RescuePackage -Title '${safeTitle}' -WingetId '${safeWinget}' -OfflineExe '${safeOffline}' -OfflineArgs '${safeArgs}'`
    );
  }

  lines.push(
    ``,
    `# Перезапуск Проводника для применения темы и настроек панели задач`,
    `Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue`,
    `Write-Host "Готово! Настройка Windows 11 успешно завершена." -ForegroundColor Green`,
    `Stop-Transcript -ErrorAction SilentlyContinue | Out-Null`
  );

  return '\uFEFF' + lines.join('\r\n');
}

export function generateWinPeInstallScript(config) {
  const diskNum = sanitizeDiskNumber(config.selectedDiskNumber);
  const plan = sanitizePartitionPlan(config);
  const lines = [
    `#Requires -RunAsAdministrator`,
    `# ==============================================================================`,
    `# Скрипт развёртывания образа Windows 11 из среды WinPE (Флешка-спаситель)`,
    `# ==============================================================================`,
    `param(`,
    `  [string]$WimPath = "",`,
    `  [int]$ImageIndex = 0,`,
    `  [switch]$DryRun`,
    `)`,
    ``,
    `$ErrorActionPreference = "Stop"`,
    `$TargetDisk = ${diskNum}`,
    `$PartitionMode = '${plan.mode}'`,
    `$TargetPartition = ${plan.partId}`,
    ``,
    `function Find-InstallImage {`,
    `  foreach ($drv in [char[]]([char]'C'..[char]'Z')) {`,
    `    foreach ($ext in @("wim", "esd")) {`,
    `      $candidate = "$($drv):\\sources\\install.$ext"`,
    `      if (Test-Path -LiteralPath $candidate) { return $candidate }`,
    `    }`,
    `  }`,
    `  return $null`,
    `}`,
    ``,
    `# [BUG-03] Освобождаем буквы S: и W: у сторонних томов (CD-ROM, флешки, другие разделы)`,
    `function Release-DriveLetter {`,
    `  param([string]$Letter)`,
    `  $vol = Get-CimInstance -ClassName Win32_Volume -Filter "DriveLetter='$($Letter):'" -ErrorAction SilentlyContinue`,
    `  if (-not $vol) { return }`,
    `  $free = [char[]]'ZYVUTRQPONMLKJIHGFED' | Where-Object { -not (Test-Path -LiteralPath "$($_):\\") } | Select-Object -First 1`,
    `  if (-not $free) { throw "Нет свободной буквы диска, чтобы освободить $($Letter):" }`,
    `  Write-Host "  Освобождаем букву $($Letter): -> $($free):" -ForegroundColor DarkGray`,
    `  Set-CimInstance -InputObject $vol -Property @{ DriveLetter = "$($free):" }`,
    `}`,
    ``,
    `Write-Host "1. Поиск установочного образа sources\\install.wim или install.esd..." -ForegroundColor Cyan`,
    `if (-not $WimPath) { $WimPath = Find-InstallImage }`,
    ``,
    `if ($DryRun) {`,
    `  Write-Host "[DRY-RUN] Режим $($PartitionMode): разметка диска $($TargetDisk) (раздел $($TargetPartition)) и применение образа $($WimPath)" -ForegroundColor Yellow`,
    `  exit 0`,
    `}`,
    ``,
    `if (-not $WimPath -or -not (Test-Path -LiteralPath $WimPath)) {`,
    `  Write-Error "Образ sources\\install.wim или install.esd не найден ни на одном носителе!"`,
    `  exit 1`,
    `}`,
    ``,
    `# [BUG-03] Автовыбор редакции Pro (индекс 1 на мультиредакционных ISO — Home). Выполняется ДО стирания диска.`,
    `if ($ImageIndex -le 0) {`,
    `  $images = @(Get-WindowsImage -ImagePath $WimPath)`,
    `  $pro = $images | Where-Object { $_.ImageName -eq 'Windows 11 Pro' } | Select-Object -First 1`,
    `  if (-not $pro) { $pro = $images | Where-Object { $_.ImageName -match '\\bPro$' } | Select-Object -First 1 }`,
    `  if ($pro) {`,
    `    $ImageIndex = [int]$pro.ImageIndex`,
    `  } else {`,
    `    $ImageIndex = 1`,
    `    Write-Warning "Редакция Windows 11 Pro не найдена в образе, используется индекс 1."`,
    `  }`,
    `  Write-Host "Выбран индекс образа: $ImageIndex" -ForegroundColor Cyan`,
    `}`,
    ``,
    `$diskpartScript = Join-Path $PSScriptRoot "diskpart-script.txt"`,
    `if (-not (Test-Path -LiteralPath $diskpartScript)) {`,
    `  throw "Сценарий разметки $diskpartScript не найден!"`,
    `}`,
    ``,
    `Write-Host "2. Подготовка букв дисков и разметка накопителя Disk $TargetDisk через DiskPart ($PartitionMode)..." -ForegroundColor Cyan`,
    `Release-DriveLetter -Letter 'S'`,
    `Release-DriveLetter -Letter 'W'`,
    `diskpart /s "$diskpartScript"`,
    `if ($LASTEXITCODE -ne 0) {`,
    `  throw "Ошибка разметки диска в DiskPart (код ошибки: $LASTEXITCODE)"`,
    `}`,
    ``,
    `# Буквы томов могли измениться после разметки — перепроверяем путь к образу`,
    `if (-not (Test-Path -LiteralPath $WimPath)) {`,
    `  $WimPath = Find-InstallImage`,
    `  if (-not $WimPath) { throw "После разметки установочный образ не найден." }`,
    `}`,
    ``,
    `if ($PartitionMode -eq 'existing_partition') {`,
    `  $esp = Get-Partition -DiskNumber $TargetDisk | Where-Object { $_.GptType -eq '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' } | Select-Object -First 1`,
    `  if (-not $esp) { throw "На диске $TargetDisk не найден раздел EFI для установки загрузчика." }`,
    `  Add-PartitionAccessPath -DiskNumber $TargetDisk -PartitionNumber $esp.PartitionNumber -AccessPath "S:"`,
    `}`,
    ``,
    `Write-Host "3. Развёртывание образа Windows 11 ($WimPath) на раздел W: (DISM /Apply-Image)..." -ForegroundColor Cyan`,
    `dism /Apply-Image /ImageFile:"$WimPath" /Index:$ImageIndex /ApplyDir:W:\\`,
    `if ($LASTEXITCODE -ne 0) {`,
    `  throw "Ошибка применения образа DISM (код ошибки: $LASTEXITCODE)"`,
    `}`,
    ``,
    `Write-Host "4. Копирование конфигурации unattend.xml (specialize/oobeSystem) и скрипта пост-установки..." -ForegroundColor Cyan`,
    `New-Item -ItemType Directory -Path "W:\\Windows\\Panther" -Force | Out-Null`,
    `New-Item -ItemType Directory -Path "W:\\Windows\\Setup\\Scripts" -Force | Out-Null`,
    ``,
    `# [V2-BUG-09] Чтение через -LiteralPath и запись unattend.xml в UTF-8 без BOM`,
    `$unattendSrc = Join-Path $PSScriptRoot "autounattend.xml"`,
    `$rawXml = Get-Content -LiteralPath $unattendSrc -Raw -Encoding UTF8`,
    `$cleanXml = [regex]::Replace($rawXml, '(?s)<settings pass="windowsPE">.*?</settings>', '')`,
    `$utf8NoBom = New-Object System.Text.UTF8Encoding($false)`,
    `[System.IO.File]::WriteAllText("W:\\Windows\\Panther\\unattend.xml", $cleanXml, $utf8NoBom)`,
    ``,
    `$postInstallSrc = Join-Path $PSScriptRoot "post-install-tweaks.ps1"`,
    `Copy-Item -LiteralPath $postInstallSrc -Destination "W:\\Windows\\Setup\\Scripts\\post-install-tweaks.ps1" -Force`,
    ``,
    `Write-Host "5. Создание загрузчика UEFI (bcdboot)..." -ForegroundColor Cyan`,
    `bcdboot W:\\Windows /s S: /f UEFI /l ru-ru`,
    `if ($LASTEXITCODE -ne 0) {`,
    `  throw "Ошибка создания загрузчика bcdboot (код ошибки: $LASTEXITCODE)"`,
    `}`,
    ``,
    `Write-Host "Установка образа завершена! ПК готов к перезагрузке." -ForegroundColor Green`,
  ];
  return '\uFEFF' + lines.join('\r\n');
}

// [V2-BUG-08] & [V3-BUG-01] Include chcp 65001 >nul and /wait flag so WinPE does not prematurely reboot
export function generateStartnetCmd() {
  return `@echo off
chcp 65001 >nul
wpeinit
powercfg /s 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c >nul 2>nul
echo Поиск накопителя Rescue USB...
for %%d in (C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
  if exist "%%d:\\RescueUSB\\win-rescue-usb.exe" (
    echo Запуск графического мастера с диска %%d:...
    start "" /wait "%%d:\\RescueUSB\\win-rescue-usb.exe" --winpe --no-sandbox --disable-gpu
    exit /b 0
  )
)
cmd.exe
`;
}

export function buildGeneratedFiles(config) {
  return {
    autounattendXml: generateAutounattendXml(config),
    diskpartScript: generateDiskpartScript(config),
    postInstallScript: generatePostInstallScript(config),
    winpeScript: generateWinPeInstallScript(config),
    startnetCmd: generateStartnetCmd(),
  };
}
