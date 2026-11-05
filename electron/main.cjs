const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

// [V3-BUG-02] Auto-detect Windows PE environment (RAM disk X:\ / SYSTEM token / Basic Display Adapter)
const isWinPE =
  (process.env.SystemDrive || '').toUpperCase() === 'X:' ||
  fs.existsSync('X:\\Windows\\System32\\wpeinit.exe') ||
  process.argv.includes('--no-sandbox');

if (isWinPE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
}

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

  // [SEC-04] Prevent opening arbitrary external windows or navigating away from the app
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  const isDev =
    Boolean(process.env.VITE_DEV_SERVER) || process.argv.includes('--dev');
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// [BUG-02] [RES-01] Query real physical disks AND their real partitions (Get-Partition / Get-Volume)
ipcMain.handle('get-disks', async () => {
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
        [PSCustomObject]@{
          Number = $d.Number
          FriendlyName = $d.FriendlyName
          BusType = [string]$d.BusType
          PartitionStyle = [string]$d.PartitionStyle
          SizeGb = [math]::Round($d.Size / 1GB, 1)
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
            const isUsb = String(d.BusType || '').toUpperCase().includes('USB');
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
                type: isUsb ? 'флешка' : isSystemPart ? 'системный' : 'основной',
              };
            });
            return {
              number: d.Number,
              model: d.FriendlyName || `Disk ${d.Number}`,
              busType: String(d.BusType || 'Unknown'),
              partitionStyle: String(d.PartitionStyle || 'Unknown'),
              sizeGb,
              freeGb: sizeGb,
              isUsb,
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
});

// [SEC-01] Блокировка системных каталогов (включая профиль пользователя, Program Files, ProgramData)
function isForbiddenExportDir(targetDir, appRootDir) {
  const sysRoot = path.resolve((process.env.SystemDrive || 'C:') + '\\').toLowerCase();
  const t = path.resolve(targetDir).toLowerCase();
  if (t === sysRoot) return true; // корень системного диска (корень флешки E:\ допустим)
  const forbidden = [
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.env.USERPROFILE,
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    appRootDir,
  ]
    .filter(Boolean)
    .map((p) => path.resolve(p).toLowerCase());
  return forbidden.some((p) => t === p || t.startsWith(p + path.sep));
}

// [SEC-02] Скрипты генерируются в Main Process из структурированного DTO конфигурации
let generatorsModulePromise = null;
function loadGenerators() {
  if (!generatorsModulePromise) {
    const file = path.join(__dirname, '..', 'src', 'utils', 'generators.js');
    generatorsModulePromise = import(pathToFileURL(file).href);
  }
  return generatorsModulePromise;
}

function sanitizeConfigDto(raw) {
  const str = (v, max) => String(v ?? '').slice(0, max);
  const strArr = (v) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 500).map((x) => x.slice(0, 100)) : [];
  return {
    brandName: str(raw.brandName, 100),
    orderNumber: str(raw.orderNumber, 100),
    profileId: str(raw.profileId, 50),
    themeId: str(raw.themeId, 50),
    colorMode: raw.colorMode === 'light' ? 'light' : 'dark',
    selectedDiskNumber: raw.selectedDiskNumber,
    selectedItems: strArr(raw.selectedItems),
    cpuVendorMode: ['amd', 'intel', 'auto'].includes(raw.cpuVendorMode) ? raw.cpuVendorMode : 'auto',
    username: str(raw.username, 20),
    selectedUserSettings: strArr(raw.selectedUserSettings),
  };
}

// [V2-SEC-01], [V3-BUG-07], [SEC-01], [SEC-02], [RES-02], [PERF-01]
ipcMain.handle('export-usb-bundle', async (_event, payload) => {
  if (isExportInProgress) {
    return { ok: false, error: 'Экспорт уже выполняется, подождите завершения операции.' };
  }
  isExportInProgress = true;
  const createdPaths = []; // для отката (RES-02): только то, чего не было до экспорта
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

    if (isForbiddenExportDir(targetDir, appRootDir) && targetDir !== path.resolve(appRootDir, 'usb-export')) {
      return {
        ok: false,
        error:
          'Безопасность: запись в системные каталоги Windows, профиль пользователя, Program Files/ProgramData, корень системного диска и папку проекта заблокирована. Выберите USB-накопитель или отдельную подпапку.',
      };
    }

    // Генерация скриптов в защищённом Main Process (диск обязан быть выбран явно — BUG-01)
    let files;
    try {
      const gen = await loadGenerators();
      files = gen.buildGeneratedFiles(sanitizeConfigDto(payload.config));
    } catch (genErr) {
      return { ok: false, error: String(genErr.message || genErr) };
    }

    lastExportedDir = targetDir;

    const rescueSubdir = path.join(targetDir, 'RescueUSB');
    const themesSubdir = path.join(rescueSubdir, 'Themes');
    const scriptsSubdir = path.join(targetDir, '$OEM$', '$$', 'Setup', 'Scripts');
    const sourcesOemRoot = path.join(targetDir, 'sources', '$OEM$');
    const sourcesOemScriptsSubdir = path.join(sourcesOemRoot, '$$', 'Setup', 'Scripts');

    // [RES-02] Запоминаем верхнеуровневые пути, которые создаём мы (для отката при сбое)
    const trackedTopLevel = [
      path.join(targetDir, 'autounattend.xml'),
      rescueSubdir,
      path.join(targetDir, '$WinPEDriver$'),
      path.join(targetDir, '$OEM$'),
      sourcesOemRoot,
    ];
    for (const p of trackedTopLevel) {
      if (!fs.existsSync(p)) createdPaths.push(p);
    }

    await Promise.all([
      fs.promises.mkdir(path.join(rescueSubdir, 'Installers'), { recursive: true }),
      fs.promises.mkdir(path.join(rescueSubdir, 'Drivers'), { recursive: true }),
      fs.promises.mkdir(themesSubdir, { recursive: true }),
      fs.promises.mkdir(path.join(targetDir, '$WinPEDriver$', 'LAN_WiFi'), { recursive: true }),
      fs.promises.mkdir(scriptsSubdir, { recursive: true }),
      fs.promises.mkdir(sourcesOemScriptsSubdir, { recursive: true }),
    ]);

    const offlineReadme = [
      '=== ОФЛАЙН-УСТАНОВЩИКИ И ДРАЙВЕРЫ RESCUE USB ===',
      '1. Поместите офлайн-инсталляторы (.exe / .msi) в папку RescueUSB\\Installers\\:',
      '   - 7z-x64.exe, ChromeStandaloneSetup64.exe, SteamSetup.exe, VC_redist.x86.exe, VC_redist.x64.exe и др.',
      '   Скрипт post-install-tweaks.ps1 автоматически установит их без интернета, а при их отсутствии использует winget.',
      '2. Поместите распакованные INF-драйверы LAN/Wi-Fi в папку $WinPEDriver$\\LAN_WiFi\\ или RescueUSB\\Drivers\\.',
    ].join('\r\n');

    const w = (p, content) => fs.promises.writeFile(p, content, 'utf8');
    const assetsThemesDir = path.join(__dirname, '..', 'assets', 'themes');
    const themeCopies = ['win11', 'win10', 'doom', 'witcher', 'stalker'].map((name) =>
      fs.promises.copyFile(
        path.join(assetsThemesDir, `${name}.bmp`),
        path.join(themesSubdir, `${name}.bmp`)
      )
    );

    await Promise.all([
      w(path.join(targetDir, 'autounattend.xml'), files.autounattendXml),
      w(path.join(rescueSubdir, 'autounattend.xml'), files.autounattendXml),
      w(path.join(rescueSubdir, 'diskpart-script.txt'), files.diskpartScript),
      w(path.join(rescueSubdir, 'post-install-tweaks.ps1'), files.postInstallScript),
      w(path.join(rescueSubdir, 'winpe-install.ps1'), files.winpeScript),
      w(path.join(rescueSubdir, 'startnet.cmd'), files.startnetCmd),
      w(path.join(rescueSubdir, 'OFFLINE_PACKAGES_README.txt'), offlineReadme),
      w(path.join(scriptsSubdir, 'post-install-tweaks.ps1'), files.postInstallScript),
      w(path.join(sourcesOemScriptsSubdir, 'post-install-tweaks.ps1'), files.postInstallScript),
      ...themeCopies,
    ]);

    return { ok: true, targetDir };
  } catch (err) {
    // [RES-02] Откат: удаляем только то, что было создано в рамках этого экспорта
    for (const p of createdPaths.reverse()) {
      try {
        await fs.promises.rm(p, { recursive: true, force: true });
      } catch (_rmErr) {
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
