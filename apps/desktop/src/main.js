// Electron main process for the Virtex desktop shell.
//
// A thin, secure wrapper around the web client (and the standalone POS terminal). It is JavaScript,
// not bundled TypeScript, on purpose: the main process has no framework and one job — open a window
// and load a trusted URL — so a build step would add a moving part without buying anything.
//
// Security posture: context isolation on, node integration off, a narrow preload, and a
// will-navigate/new-window guard that refuses to follow links outside the configured origins. The
// renderer is ordinary web content and is treated as such.
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PORTAL_URL = process.env.DESKTOP_PORTAL_URL || 'http://localhost:4200';
const POS_URL = process.env.DESKTOP_POS_URL || 'http://localhost:4300';

const ALLOWED_ORIGINS = [PORTAL_URL, POS_URL].map((u) => originOf(u)).filter(Boolean);

/** @type {BrowserWindow | null} */
let mainWindow = null;

/**
 * The native menu's own catalogue, and the language it is drawn in.
 *
 * ## Why the main process needs its own
 *
 * The menu is drawn by the operating system before any page has loaded, so it cannot go through
 * `TranslateService` — there is no renderer yet. Its three labels used to be English literals, which
 * meant the first thing a Dominican user saw on opening the desktop application was "Go / Portal /
 * Point of sale" in a product that is otherwise Spanish.
 *
 * `tools/i18n/build-catalogues.mjs` emits `src/i18n/<lang>.json` for the `desktop` namespace from
 * the same source as every other catalogue, so these three strings are translated in the same place
 * and by the same process as the rest of the product.
 *
 * The language comes from the renderer, which writes the reader's choice to `localStorage` under
 * `vx-language` (`LANGUAGE_STORAGE_KEY` in `libs/shared/ui-i18n`). The menu is rebuilt when the
 * renderer reports it, so switching language in the web client redraws the native menu too.
 */
const SUPPORTED_LANGUAGES = ['es', 'en', 'pt'];
const DEFAULT_LANGUAGE = 'es';

let menuLanguage = DEFAULT_LANGUAGE;

/** @type {Record<string, Record<string, string>>} */
const catalogues = {};

function catalogue(language) {
  if (catalogues[language]) return catalogues[language];
  try {
    catalogues[language] = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'i18n', `${language}.json`), 'utf8'),
    );
  } catch {
    // A missing catalogue must not stop the window opening. An English-shaped label is a worse
    // experience than a translated one and a much better one than no application.
    catalogues[language] = {};
  }
  return catalogues[language];
}

function t(key) {
  const table = catalogue(menuLanguage);
  if (typeof table[key] === 'string') return table[key];
  const fallback = catalogue(DEFAULT_LANGUAGE);
  return typeof fallback[key] === 'string' ? fallback[key] : key;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#141414',
    show: false,
    //  El armazón de la aplicación (la barra superior del cliente web) HACE de
    //  barra de título. Por eso se retira la del sistema y se deja que el
    //  renderer pinte la suya:
    //
    //   - macOS: `hidden` conserva los semáforos (cerrar/minimizar/pantalla) en
    //     su esquina y solo esconde la franja de título. `trafficLightPosition`
    //     los centra en la barra de 64 px del cliente; el CSS reserva ese hueco.
    //   - Windows/Linux: `frame: false` retira marco y botones nativos —los
    //     dibuja y controla el propio topbar—, sin perder el redimensionado ni
    //     la maximización, que Electron mantiene en ventanas sin marco.
    ...(isMac
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 24 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.loadURL(PORTAL_URL);

  //  El botón de maximizar/restaurar del topbar tiene que mostrar el estado
  //  real de la ventana, y ese estado cambia también por gestos que no pasan
  //  por él —arrastrar al borde, atajo del sistema, doble clic—. Se le avisa al
  //  renderer en cada transición para que el icono no mienta.
  const reportMaximized = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('virtex:window-maximized', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', reportMaximized);
  mainWindow.on('unmaximize', reportMaximized);

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

  // The stored choice lives in the renderer's `localStorage`, which the main process cannot read
  // directly. Asking for it once the page is ready is what makes the menu match the language the
  // reader left the application in.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents
      .executeJavaScript("window.localStorage.getItem('vx-language')", true)
      .then((language) => applyLanguage(String(language ?? '')))
      .catch(() => undefined);
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
      label: t('desktop.menu.go'),
      submenu: [
        {
          label: t('desktop.menu.portal'),
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow && mainWindow.loadURL(PORTAL_URL),
        },
        {
          label: t('desktop.menu.point_of_sale'),
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

/**
 * Draw the menu in the language the renderer is using.
 *
 * Called on startup with whatever the last session stored, and again whenever the renderer reports a
 * change. Rebuilding is cheap — three strings and a template — and the alternative is a native menu
 * that stays in the previous language until the application restarts.
 */
function applyLanguage(language) {
  const next = SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  if (next === menuLanguage) return;
  menuLanguage = next;
  buildMenu();
}

ipcMain.on('virtex:language', (_event, language) => applyLanguage(String(language ?? '')));

//  Controles de ventana del topbar. La acción la ejecuta SIEMPRE el proceso
//  principal —el renderer no tiene ninguna capacidad sobre la ventana— y se
//  resuelve sobre la ventana que emite el evento, no sobre una referencia
//  global, para que siga siendo correcto si algún día hay más de una.
ipcMain.on('virtex:window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('virtex:window-maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('virtex:window-close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

//  Estado inicial: el renderer lo pide al montar el topbar para dibujar el
//  icono correcto antes de la primera transición.
ipcMain.handle('virtex:window-is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

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
