const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let mainWindow = null;
let lastExportedDir = path.resolve(__dirname, '..', 'usb-export');

// Helper: Generate a compact valid 24-bit BMP image buffer (64x36 gradient) for theme wallpapers
function createGradientBmpBuffer(r1, g1, b1, r2, g2, b2) {
  const width = 64;
  const height = 36;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER (14 bytes)
  buf.write('BM', 0, 2, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    const tY = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const tX = x / (width - 1);
      const t = (tX + tY) / 2;
      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      const offset = 54 + y * rowSize + x * 3;
      buf[offset] = b;
      buf[offset + 1] = g;
      buf[offset + 2] = r;
    }
  }
  return buf;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0b1017',
    autoHideMenuBar: true,
    title: 'Fosters PC — Rescue USB Installer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

// [ERR-03] & [BUG-08] Query real physical disks via PowerShell Get-Disk with UTF-8 encoding
ipcMain.handle('get-disks', async () => {
  return new Promise((resolve) => {
    const psScript = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $ErrorActionPreference = 'Stop'
      $disks = Get-Disk | Select-Object Number, FriendlyName, BusType, PartitionStyle, @{Name='SizeGb';Expression={[math]::Round($_.Size / 1GB, 1)}}, IsSystem, IsBoot
      $disks | ConvertTo-Json -Compress
    `;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { timeout: 6000, encoding: 'utf8' },
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
            const sizeGb =
              Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0;
            const isUsb = String(d.BusType || '').toUpperCase().includes('USB');
            const mainSize = Math.max(0, +(sizeGb - 0.32).toFixed(1));
            return {
              number: d.Number ?? 0,
              model: d.FriendlyName || `Disk ${d.Number}`,
              busType: String(d.BusType || 'NVMe'),
              partitionStyle: String(d.PartitionStyle || 'GPT'),
              sizeGb,
              freeGb: sizeGb,
              isUsb,
              isSystem: Boolean(d.IsSystem || d.IsBoot),
              partitions: isUsb
                ? [
                    {
                      id: 1,
                      label: 'Раздел 1 · Загрузочная флешка Rescue USB',
                      sizeGb,
                      fs: 'NTFS',
                      type: 'флешка',
                    },
                  ]
                : [
                    {
                      id: 1,
                      label: 'Раздел 1 · Системный EFI',
                      sizeGb: 0.3,
                      fs: 'FAT32',
                      type: 'системный',
                    },
                    {
                      id: 2,
                      label: 'Раздел 2 · Зарезервировано Microsoft',
                      sizeGb: 0.0,
                      fs: 'MSR',
                      type: 'системный',
                    },
                    {
                      id: 3,
                      label: 'Раздел 3 · Основной раздел · C',
                      sizeGb: mainSize,
                      fs: 'NTFS',
                      type: 'основной',
                    },
                  ],
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

// [BUG-03] & [PERF-01] Export generated files asynchronously with cancel handling & offline folders
ipcMain.handle('export-usb-bundle', async (_event, payload) => {
  try {
    let targetDir = path.resolve(__dirname, '..', 'usb-export');
    if (payload?.askFolder && mainWindow) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите флешку или папку для экспорта комплекта Rescue USB',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) {
        return {
          ok: false,
          canceled: true,
          error: 'Выбор папки отменён пользователем',
        };
      }
      targetDir = path.resolve(result.filePaths[0]);
    }

    lastExportedDir = targetDir;

    const rescueSubdir = path.join(targetDir, 'RescueUSB');
    const installersSubdir = path.join(rescueSubdir, 'Installers');
    const driversSubdir = path.join(rescueSubdir, 'Drivers');
    const themesSubdir = path.join(rescueSubdir, 'Themes');
    const winpeDriverSubdir = path.join(targetDir, '$WinPEDriver$', 'LAN_WiFi');
    const scriptsSubdir = path.join(targetDir, '$OEM$', '$$', 'Setup', 'Scripts');

    await Promise.all([
      fs.promises.mkdir(rescueSubdir, { recursive: true }),
      fs.promises.mkdir(installersSubdir, { recursive: true }),
      fs.promises.mkdir(driversSubdir, { recursive: true }),
      fs.promises.mkdir(themesSubdir, { recursive: true }),
      fs.promises.mkdir(winpeDriverSubdir, { recursive: true }),
      fs.promises.mkdir(scriptsSubdir, { recursive: true }),
    ]);

    const offlineReadme = [
      '=== ОФЛАЙН-УСТАНОВЩИКИ И ДРАЙВЕРЫ RESCUE USB ===',
      '1. Поместите офлайн-инсталляторы (.exe / .msi) в папку RescueUSB\\Installers\\:',
      '   - 7z-x64.exe, ChromeStandaloneSetup64.exe, SteamSetup.exe, VC_redist.x86.exe, VC_redist.x64.exe и др.',
      '   Скрипт post-install-tweaks.ps1 автоматически установит их без интернета, а при их отсутствии использует winget.',
      '2. Поместите распакованные INF-драйверы LAN/Wi-Fi в папку $WinPEDriver$\\LAN_WiFi\\ или RescueUSB\\Drivers\\.',
    ].join('\r\n');

    await Promise.all([
      fs.promises.writeFile(
        path.join(targetDir, 'autounattend.xml'),
        String(payload.autounattendXml || ''),
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(rescueSubdir, 'autounattend.xml'),
        String(payload.autounattendXml || ''),
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(rescueSubdir, 'diskpart-script.txt'),
        String(payload.diskpartScript || ''),
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(rescueSubdir, 'post-install-tweaks.ps1'),
        String(payload.postInstallScript || ''),
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(rescueSubdir, 'winpe-install.ps1'),
        String(payload.winpeScript || ''),
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(rescueSubdir, 'startnet.cmd'),
        String(payload.startnetCmd || ''),
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(rescueSubdir, 'OFFLINE_PACKAGES_README.txt'),
        offlineReadme,
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(scriptsSubdir, 'post-install-tweaks.ps1'),
        String(payload.postInstallScript || ''),
        'utf8'
      ),
      // Generate theme wallpaper BMP files so gaming/classic themes have real wallpapers to apply
      fs.promises.writeFile(
        path.join(themesSubdir, 'win11.bmp'),
        createGradientBmpBuffer(10, 35, 90, 0, 120, 212)
      ),
      fs.promises.writeFile(
        path.join(themesSubdir, 'win10.bmp'),
        createGradientBmpBuffer(5, 45, 110, 0, 162, 237)
      ),
      fs.promises.writeFile(
        path.join(themesSubdir, 'doom.bmp'),
        createGradientBmpBuffer(25, 5, 5, 190, 35, 15)
      ),
      fs.promises.writeFile(
        path.join(themesSubdir, 'witcher.bmp'),
        createGradientBmpBuffer(18, 22, 28, 85, 100, 120)
      ),
      fs.promises.writeFile(
        path.join(themesSubdir, 'stalker.bmp'),
        createGradientBmpBuffer(25, 20, 10, 180, 115, 15)
      ),
    ]);

    return { ok: true, targetDir };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
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

// Section 4.1: Update window title dynamically when brand name changes
ipcMain.handle('set-window-title', (_event, rawBrand) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const cleanBrand = String(rawBrand || 'Fosters PC')
      .replace(/[\r\n\0]/g, '')
      .trim()
      .slice(0, 50);
    mainWindow.setTitle(`${cleanBrand || 'Fosters PC'} — Rescue USB Installer`);
  }
  return { ok: true };
});

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.close();
});
