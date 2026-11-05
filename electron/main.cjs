const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let mainWindow = null;

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
    },
  });

  const devUrl = 'http://localhost:5173';
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');

  if (fs.existsSync(distIndex) && !process.env.VITE_DEV_SERVER) {
    mainWindow.loadFile(distIndex);
  } else {
    mainWindow.loadURL(devUrl).catch(() => {
      if (fs.existsSync(distIndex)) {
        mainWindow.loadFile(distIndex);
      }
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

// Query real disks via PowerShell Get-Disk
ipcMain.handle('get-disks', async () => {
  return new Promise((resolve) => {
    const psScript = `
      $ErrorActionPreference = 'SilentlyContinue'
      $disks = Get-Disk | Select-Object Number, FriendlyName, BusType, PartitionStyle, @{Name='SizeGb';Expression={[math]::Round($_.Size / 1GB, 1)}}, IsSystem, IsBoot
      $disks | ConvertTo-Json -Compress
    `;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { timeout: 6000 },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          resolve({ ok: false, disks: [] });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const mapped = list.map((d) => {
            const sizeGb = Number(d.SizeGb) || 512;
            const isUsb = String(d.BusType || '').toUpperCase().includes('USB');
            const mainSize = Math.max(1, +(sizeGb - 0.32).toFixed(1));
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
        } catch (e) {
          resolve({ ok: false, disks: [] });
        }
      }
    );
  });
});

// Export generated files to usb-export directory or user-selected folder
ipcMain.handle('export-usb-bundle', async (_event, payload) => {
  try {
    let targetDir = path.join(__dirname, '..', 'usb-export');
    if (payload.askFolder && mainWindow) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите флешку или папку для экспорта комплекта Rescue USB',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (!result.canceled && result.filePaths && result.filePaths[0]) {
        targetDir = result.filePaths[0];
      }
    }

    const rescueSubdir = path.join(targetDir, 'RescueUSB');
    const scriptsSubdir = path.join(targetDir, '$OEM$', '$$', 'Setup', 'Scripts');

    fs.mkdirSync(rescueSubdir, { recursive: true });
    fs.mkdirSync(scriptsSubdir, { recursive: true });

    // 1. Root autounattend.xml for automatic pickup by Windows Setup / WinPE
    fs.writeFileSync(path.join(targetDir, 'autounattend.xml'), payload.autounattendXml, 'utf8');

    // 2. RescueUSB scripts
    fs.writeFileSync(path.join(rescueSubdir, 'autounattend.xml'), payload.autounattendXml, 'utf8');
    fs.writeFileSync(path.join(rescueSubdir, 'diskpart-script.txt'), payload.diskpartScript, 'utf8');
    fs.writeFileSync(path.join(rescueSubdir, 'post-install-tweaks.ps1'), payload.postInstallScript, 'utf8');
    fs.writeFileSync(path.join(rescueSubdir, 'winpe-install.ps1'), payload.winpeScript, 'utf8');
    fs.writeFileSync(path.join(rescueSubdir, 'startnet.cmd'), payload.startnetCmd, 'utf8');

    // 3. $OEM$ folder structure so standard Windows ISO/USB automatically copies post-install-tweaks.ps1 to C:\Windows\Setup\Scripts\
    fs.writeFileSync(path.join(scriptsSubdir, 'post-install-tweaks.ps1'), payload.postInstallScript, 'utf8');

    return { ok: true, targetDir };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('open-export-folder', async (_event, folderPath) => {
  const dir = folderPath || path.join(__dirname, '..', 'usb-export');
  if (fs.existsSync(dir)) {
    await shell.openPath(dir);
  }
  return { ok: true };
});

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.close();
});
