// Electron main process for the Virtex desktop shell.
//
// A thin, secure wrapper around the web client (and the standalone POS terminal). It is JavaScript,
// not bundled TypeScript, on purpose: the main process has no framework and one job — open a window
// and load a trusted URL — so a build step would add a moving part without buying anything.
//
// Security posture: context isolation on, node integration off, a narrow preload, and a
// will-navigate/new-window guard that refuses to follow links outside the configured origins. The
// renderer is ordinary web content and is treated as such.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

const PORTAL_URL = process.env.DESKTOP_PORTAL_URL || 'http://localhost:4200';
const POS_URL = process.env.DESKTOP_POS_URL || 'http://localhost:4300';

const ALLOWED_ORIGINS = [PORTAL_URL, POS_URL].map((u) => originOf(u)).filter(Boolean);

/** @type {BrowserWindow | null} */
let mainWindow = null;

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#141414',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.loadURL(PORTAL_URL);

  // Keep navigation inside the trusted origins; anything else opens in the system browser.
  const guard = (event, url) => {
    if (!ALLOWED_ORIGINS.includes(originOf(url))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  };
  mainWindow.webContents.on('will-navigate', guard);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (ALLOWED_ORIGINS.includes(originOf(url))) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Go',
      submenu: [
        {
          label: 'Portal',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow && mainWindow.loadURL(PORTAL_URL),
        },
        {
          label: 'Point of sale',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow && mainWindow.loadURL(POS_URL),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
