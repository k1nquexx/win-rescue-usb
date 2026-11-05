const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

// [SEC-04] WinPE определяется строго: системный диск X: И наличие wpeinit.exe, либо явный флаг --winpe
// (наличие произвольного диска X: на обычной ОС больше не отключает песочницу Chromium)
const sysDriveUpper = (process.env.SystemDrive || '').toUpperCase();
const isWinPE =
  (sysDriveUpper === 'X:' && fs.existsSync('X:\\Windows\\System32\\wpeinit.exe')) ||
  process.argv.includes('--winpe');

if (isWinPE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
}

const isDev = Boolean(process.env.VITE_DEV_SERVER) || process.argv.includes('--dev');

// [V2-ARCH-01] Read default branding configuration from src/data/branding.json
let branding = {
  brandName: 'Fosters PC',
  windowTitleSuffix: 'Rescue USB Installer',
};
try {
  const brandingPath = path.join(__dirname, '..', 'src', 'data', 'branding.json');
  if (fs.existsSync(brandingPath)) {
    branding = { ...branding, ...JSON.parse(fs.readFileSync(brandingPath, 'utf8')) };
  }
} catch (_err) {
  // Fallback defaults remain active
}

const titleSuffix = branding.windowTitleSuffix || 'Rescue USB Installer';

let mainWindow = null;
let lastExportedDir = path.resolve(__dirname, '..', 'usb-export');
let isExportInProgress = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0b1017',
    autoHideMenuBar: true,
    title: `${branding.brandName || 'Fosters PC'} — ${titleSuffix}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !isWinPE,
    },
  });

  // [SEC-04] [SEC-05] Prevent opening arbitrary windows, webviews, or navigating/redirecting away from the app
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.on('will-redirect', (e) => e.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault());

  const devUrl = 'http://localhost:5173';
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

  if (isDev) {
    mainWindow.loadURL(devUrl).catch(() => {
      if (fs.existsSync(distIndex)) {
        mainWindow.loadFile(distIndex);
      }
    });
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex);
  } else {
    mainWindow.loadURL(devUrl).catch((err) => {
      console.error('Failed to load application UI:', err);
    });
  }
}

app.whenReady().then(() => {
  // [SEC-05] Content-Security-Policy на уровне сессии для dev и production
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const policy = isDev
      ? "default-src 'self' http://localhost:5173 ws://localhost:5173; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' http://localhost:5173 ws://localhost:5173;"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// [BUG-02] [BUG-04] [RES-01] Query real physical disks, real partitions and real unallocated space
function queryDisks() {
  return new Promise((resolve) => {
    const psScript = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $ErrorActionPreference = 'Stop'
      $result = @(Get-Disk | Sort-Object Number | ForEach-Object {
        $d = $_
        $parts = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | ForEach-Object {
          $vol = Get-Volume -Partition $_ -ErrorAction SilentlyContinue
          $letter = if ($_.DriveLetter) { [string]$_.DriveLetter } else { '' }
          [PSCustomObject]@{
            id = $_.PartitionNumber
            label = if ($vol -and $vol.FileSystemLabel) { [string]$vol.FileSystemLabel } else { '' }
            letter = $letter
            sizeGb = [math]::Round($_.Size / 1GB, 2)
            fs = if ($vol -and $vol.FileSystem) { [string]$vol.FileSystem } else { [string]$_.Type }
            ptype = [string]$_.Type
          }
        })
        $unallocated = [math]::Max(0, $d.Size - $d.AllocatedSize)
        [PSCustomObject]@{
          Number = $d.Number
          FriendlyName = $d.FriendlyName
          BusType = [string]$d.BusType
          PartitionStyle = [string]$d.PartitionStyle
          SizeGb = [math]::Round($d.Size / 1GB, 1)
          FreeGb = [math]::Round($unallocated / 1GB, 1)
          IsSystem = $d.IsSystem
          IsBoot = $d.IsBoot
          IsReadOnly = $d.IsReadOnly
          IsOffline = $d.IsOffline
          Partitions = $parts
        }
      })
      ConvertTo-Json -InputObject $result -Depth 4 -Compress
    `;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { timeout: 30000, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err || !stdout || !stdout.trim()) {
          const errMsg = stderr?.trim() || err?.message || 'Empty output from Get-Disk';
          console.warn('[get-disks] PowerShell warning:', errMsg);
          resolve({ ok: false, error: errMsg, disks: [] });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const mapped = list.map((d) => {
            const parsedSize = Number(d.SizeGb);
            const sizeGb = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0;
            const parsedFree = Number(d.FreeGb);
            const freeGb = Number.isFinite(parsedFree) && parsedFree >= 0 ? parsedFree : 0;
            const isUsbBus = String(d.BusType || '').toUpperCase().includes('USB');
            // [BUG-04] В WinPE загрузочный/системный носитель защищён от стирания независимо от шины
            const isWinPeBootDisk = isWinPE && Boolean(d.IsBoot || d.IsSystem);
            const rawParts = Array.isArray(d.Partitions)
              ? d.Partitions
              : d.Partitions
                ? [d.Partitions]
                : [];
            const partitions = rawParts.map((p) => {
              const ptype = String(p.ptype || '');
              const isSystemPart = /system|reserved|recovery/i.test(ptype);
              const baseLabel = p.label || `Раздел ${p.id}`;
              const letterSuffix = p.letter ? ` (${p.letter}:)` : '';
              return {
                id: Number(p.id),
                label: `Раздел ${p.id} · ${baseLabel}${letterSuffix}`,
                sizeGb: Number(p.sizeGb) || 0,
                fs: String(p.fs || ptype || '—'),
                type: isUsbBus ? 'флешка' : isSystemPart ? 'системный' : 'основной',
              };
            });
            return {
              number: d.Number,
              model: d.FriendlyName || `Disk ${d.Number}`,
              busType: String(d.BusType || 'Unknown'),
              partitionStyle: String(d.PartitionStyle || 'Unknown'),
              sizeGb,
              freeGb,
              isUsb: isUsbBus || isWinPeBootDisk,
              isSystem: Boolean(d.IsSystem || d.IsBoot),
              isReadOnly: Boolean(d.IsReadOnly),
              isOffline: Boolean(d.IsOffline),
              partitions,
            };
          });
          resolve({ ok: true, disks: mapped });
        } catch (parseErr) {
          console.error('[get-disks] JSON parse error:', parseErr);
          resolve({
            ok: false,
            error: String(parseErr.message || parseErr),
            disks: [],
          });
        }
      }
    );
  });
}

ipcMain.handle('get-disks', () => queryDisks());

// [SEC-03] Разрешение реального пути: симлинки / NTFS Junctions раскрываются через realpath ближайшего существующего предка
function resolveRealOrLexical(p) {
  const abs = path.resolve(p);
  let current = abs;
  const rest = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const real = fs.realpathSync.native(current);
      return path.join(real, ...rest.reverse());
    } catch (_err) {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

// [SEC-01] [SEC-03] Блокировка системных каталогов; подпапки профиля (Desktop/Documents/Downloads) разрешены
function isForbiddenExportDir(targetDir, appRootDir) {
  const sysDrive = (process.env.SystemDrive || 'C:').replace(/[\\/]+$/, '');
  const sysRoot = resolveRealOrLexical(sysDrive + '\\').toLowerCase();
  const t = resolveRealOrLexical(targetDir).toLowerCase();
  const allowedDefaultExport = resolveRealOrLexical(path.join(appRootDir, 'usb-export')).toLowerCase();
  if (t === allowedDefaultExport) return false;

  const userProfile = process.env.USERPROFILE
    ? resolveRealOrLexical(process.env.USERPROFILE).toLowerCase()
    : null;
  // Блокируем корень системного диска и сам корень профиля (но не его подпапки Desktop/Downloads)
  if (t === sysRoot || (userProfile && t === userProfile)) return true;

  const forbiddenPrefixes = [
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    path.join(sysDrive + '\\', 'Boot'),
    path.join(sysDrive + '\\', 'EFI'),
    path.join(sysDrive + '\\', 'Recovery'),
    appRootDir,
  ]
    .filter(Boolean)
    .map((p) => resolveRealOrLexical(p).toLowerCase());

  return forbiddenPrefixes.some((p) => t === p || t.startsWith(p + path.sep));
}

// [SEC-02] Скрипты генерируются в Main Process из структурированного DTO конфигурации
// [ERR-04] Отклонённый промис не кэшируется: при сбое импорта кэш сбрасывается
let generatorsModulePromise = null;
function loadGenerators() {
  if (!generatorsModulePromise) {
    const file = path.join(__dirname, '..', 'src', 'utils', 'generators.js');
    generatorsModulePromise = import(pathToFileURL(file).href).catch((err) => {
      generatorsModulePromise = null;
      throw err;
    });
  }
  return generatorsModulePromise;
}

function sanitizeConfigDto(raw) {
  const str = (v, max) => String(v ?? '').slice(0, max);
  const strArr = (v) =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === 'string').slice(0, 500).map((x) => x.slice(0, 100))
      : [];
  return {
    brandName: str(raw.brandName, 100),
    orderNumber: str(raw.orderNumber, 100),
    profileId: str(raw.profileId, 50),
    themeId: str(raw.themeId, 50),
    colorMode: raw.colorMode === 'light' ? 'light' : 'dark',
    selectedDiskNumber: raw.selectedDiskNumber,
    partitionMode: raw.partitionMode === 'existing_partition' ? 'existing_partition' : 'wipe_gpt',
    selectedPartitionId: raw.selectedPartitionId,
    selectedItems: strArr(raw.selectedItems),
    cpuVendorMode: ['amd', 'intel', 'auto'].includes(raw.cpuVendorMode) ? raw.cpuVendorMode : 'auto',
    username: str(raw.username, 20),
    selectedUserSettings: strArr(raw.selectedUserSettings),
  };
}

const pathExists = (p) =>
  fs.promises.access(p).then(
    () => true,
    () => false
  );

// [V2-SEC-01], [V3-BUG-07], [SEC-01..03], [RES-02], [ERR-03], [PERF-01], [PERF-02]
ipcMain.handle('export-usb-bundle', async (_event, payload) => {
  if (isExportInProgress) {
    return { ok: false, error: 'Экспорт уже выполняется, подождите завершения операции.' };
  }
  isExportInProgress = true;
  const createdPaths = []; // что создано этим экспортом (удаляется при откате)
  const backups = new Map(); // путь -> прежнее содержимое перезаписываемого файла (восстанавливается при откате)
  try {
    if (!payload || typeof payload !== 'object' || !payload.config || typeof payload.config !== 'object') {
      return { ok: false, error: 'Некорректные данные конфигурации для экспорта' };
    }

    const appRootDir = path.resolve(__dirname, '..');
    let targetDir = path.resolve(appRootDir, 'usb-export');

    if (payload.askFolder === true && mainWindow) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите флешку или папку для экспорта комплекта Rescue USB',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) {
        return { ok: false, canceled: true, error: 'Выбор папки отменён пользователем' };
      }
      targetDir = path.resolve(result.filePaths[0]);
    }

    if (isForbiddenExportDir(targetDir, appRootDir)) {
      return {
        ok: false,
        error:
          'Безопасность: запись в системные каталоги Windows (Windows, Program Files, ProgramData, AppData, Boot/EFI/Recovery), корень системного диска, корень профиля пользователя и папку проекта заблокирована. Выберите USB-накопитель или отдельную подпапку.',
      };
    }

    const cleanDto = sanitizeConfigDto(payload.config);

    // [SEC-01] Валидация целевого диска/раздела в Main Process по актуальному списку физических дисков
    const diskNumber = Number(cleanDto.selectedDiskNumber);
    if (
      cleanDto.selectedDiskNumber === null ||
      cleanDto.selectedDiskNumber === undefined ||
      cleanDto.selectedDiskNumber === '' ||
      !Number.isInteger(diskNumber) ||
      diskNumber < 0
    ) {
      return { ok: false, error: 'Целевой диск для развертывания не выбран.' };
    }
    const diskQuery = await queryDisks();
    if (!diskQuery.ok) {
      return {
        ok: false,
        error: `Не удалось проверить целевой диск (запустите приложение от имени Администратора): ${diskQuery.error}`,
      };
    }
    const targetDisk = diskQuery.disks.find((d) => d.number === diskNumber);
    if (!targetDisk) {
      return { ok: false, error: `Диск ${diskNumber} не найден в системе.` };
    }
    if (targetDisk.isUsb || targetDisk.isReadOnly || targetDisk.isOffline) {
      return {
        ok: false,
        error: `Диск ${diskNumber} защищён от записи (USB / загрузочный носитель / только чтение / офлайн).`,
      };
    }
    if (cleanDto.partitionMode === 'existing_partition') {
      const partId = Number(cleanDto.selectedPartitionId);
      const part = targetDisk.partitions.find((p) => p.id === partId);
      if (!part) {
        return { ok: false, error: `Раздел ${cleanDto.selectedPartitionId} не найден на диске ${diskNumber}.` };
      }
      if (part.type === 'системный') {
        return { ok: false, error: 'Системные разделы (EFI / MSR / Recovery) нельзя выбирать как цель установки.' };
      }
    }

    // Генерация скриптов в защищённом Main Process
    let files;
    try {
      const gen = await loadGenerators();
      files = gen.buildGeneratedFiles(cleanDto);
    } catch (genErr) {
      return { ok: false, error: String(genErr.message || genErr) };
    }

    lastExportedDir = targetDir;

    const rescueSubdir = path.join(targetDir, 'RescueUSB');
    const themesSubdir = path.join(rescueSubdir, 'Themes');
    const scriptsSubdir = path.join(targetDir, '$OEM$', '$$', 'Setup', 'Scripts');
    const sourcesOemScriptsSubdir = path.join(targetDir, 'sources', '$OEM$', '$$', 'Setup', 'Scripts');

    // [ERR-03] [PERF-01] Создание каталогов с учётом первого НЕсуществующего предка (без sync I/O)
    const mkdirTracked = async (dir) => {
      let cur = path.resolve(dir);
      let firstMissing = null;
      while (!(await pathExists(cur))) {
        firstMissing = cur;
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
      if (firstMissing) createdPaths.push(firstMissing);
      await fs.promises.mkdir(dir, { recursive: true });
    };

    for (const dir of [
      path.join(rescueSubdir, 'Installers'),
      path.join(rescueSubdir, 'Drivers'),
      themesSubdir,
      path.join(targetDir, '$WinPEDriver$', 'LAN_WiFi'),
      scriptsSubdir,
      sourcesOemScriptsSubdir,
    ]) {
      await mkdirTracked(dir);
    }

    const offlineReadme = [
      '=== ОФЛАЙН-УСТАНОВЩИКИ И ДРАЙВЕРЫ RESCUE USB ===',
      '1. Поместите офлайн-инсталляторы (.exe / .msi) в папку RescueUSB\\Installers\\:',
      '   - 7z-x64.exe, ChromeStandaloneSetup64.exe, SteamSetup.exe, VC_redist.x86.exe, VC_redist.x64.exe и др.',
      '   Скрипт post-install-tweaks.ps1 устанавливает ТОЛЬКО файлы с валидной цифровой подписью Authenticode;',
      '   неподписанные или изменённые файлы пропускаются, а при их отсутствии используется winget.',
      '2. Поместите распакованные INF-драйверы LAN/Wi-Fi в папку $WinPEDriver$\\LAN_WiFi\\ или RescueUSB\\Drivers\\.',
    ].join('\r\n');

    const assetsThemesDir = path.join(__dirname, '..', 'assets', 'themes');

    // Список записей: [путь назначения, содержимое строкой | { copyFrom }]
    const jobs = [
      [path.join(targetDir, 'autounattend.xml'), files.autounattendXml],
      [path.join(rescueSubdir, 'autounattend.xml'), files.autounattendXml],
      [path.join(rescueSubdir, 'diskpart-script.txt'), files.diskpartScript],
      [path.join(rescueSubdir, 'post-install-tweaks.ps1'), files.postInstallScript],
      [path.join(rescueSubdir, 'winpe-install.ps1'), files.winpeScript],
      [path.join(rescueSubdir, 'startnet.cmd'), files.startnetCmd],
      [path.join(rescueSubdir, 'OFFLINE_PACKAGES_README.txt'), offlineReadme],
      [path.join(scriptsSubdir, 'post-install-tweaks.ps1'), files.postInstallScript],
      [path.join(sourcesOemScriptsSubdir, 'post-install-tweaks.ps1'), files.postInstallScript],
      ...['win11', 'win10', 'doom', 'witcher', 'stalker'].map((name) => [
        path.join(themesSubdir, `${name}.bmp`),
        { copyFrom: path.join(assetsThemesDir, `${name}.bmp`) },
      ]),
    ];

    // [ERR-03] Перед перезаписью сохраняем прежние файлы (для отката), новые файлы помечаем как созданные
    for (const [dest] of jobs) {
      if (await pathExists(dest)) {
        backups.set(dest, await fs.promises.readFile(dest));
      } else {
        createdPaths.push(dest);
      }
    }

    await Promise.all(
      jobs.map(([dest, content]) =>
        typeof content === 'string'
          ? fs.promises.writeFile(dest, content, 'utf8')
          : fs.promises.copyFile(content.copyFrom, dest)
      )
    );

    return { ok: true, targetDir };
  } catch (err) {
    // [RES-02] [ERR-03] Откат: удаляем созданное и восстанавливаем перезаписанные файлы
    for (const p of [...createdPaths].reverse()) {
      try {
        await fs.promises.rm(p, { recursive: true, force: true });
      } catch (_rmErr) {
        // best effort
      }
    }
    for (const [p, data] of backups) {
      try {
        await fs.promises.writeFile(p, data);
      } catch (_wErr) {
        // best effort
      }
    }
    return { ok: false, error: String(err.message || err) };
  } finally {
    isExportInProgress = false;
  }
});

// [SEC-03] Safely open only the verified lastExportedDir directory
ipcMain.handle('open-export-folder', async () => {
  try {
    const stat = await fs.promises.stat(lastExportedDir);
    if (!stat.isDirectory()) {
      return { ok: false, error: 'Указанный путь не является директорией' };
    }
    const errMsg = await shell.openPath(lastExportedDir);
    return errMsg ? { ok: false, error: errMsg } : { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// [V2-ARCH-01] Update window title dynamically using branding.windowTitleSuffix
ipcMain.handle('set-window-title', (_event, rawBrand) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const cleanBrand = String(rawBrand || branding.brandName || 'Fosters PC')
      .replace(/[\r\n\0]/g, '')
      .trim()
      .slice(0, 50);
    mainWindow.setTitle(
      `${cleanBrand || branding.brandName || 'Fosters PC'} — ${titleSuffix}`
    );
  }
  return { ok: true };
});

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.close();
});
