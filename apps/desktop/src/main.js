// Electron main process for the Virtex desktop shell.
//
// A thin, secure wrapper around the web client (and the standalone POS terminal). It is JavaScript,
// not bundled TypeScript, on purpose: the main process has no framework and one job — open a window
// and load a trusted URL — so a build step would add a moving part without buying anything.
//
// Security posture, in the order a request meets it:
//   - every renderer is sandboxed (`app.enableSandbox()`), with context isolation, no Node, and a
//     narrow preload;
//   - the window may only show the two configured origins; links elsewhere go to the system browser
//     and only for https/mailto;
//   - TLS: the operating system's verification always applies, certificate errors are refused, and
//     optional public-key pins narrow it further for the configured hosts;
//   - every trusted page receives a baseline CSP on top of the server's (it can only tighten);
//   - permissions are denied except a short list, and only to trusted origins;
//   - the packaged binary carries Electron fuses (no ELECTRON_RUN_AS_NODE, no --inspect, no
//     NODE_OPTIONS, asar integrity, app code only from the asar) — see electron-builder.config.cjs;
//   - updates are installed only after a signed release statement verifies (updater.js).
//
// Every trust decision is a pure function in security-policy.js / release-verification.js /
// app-config.js, tested with `node --test` without Electron.
const {
  app,
  BrowserWindow,
  Menu,
  crashReporter,
  dialog,
  ipcMain,
  net,
  powerMonitor,
  session,
  shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const policy = require('./security-policy');
const { loadAppConfig } = require('./app-config');
const { createLogger } = require('./logger');
const { createUpdateController } = require('./updater');

// Sandbox every renderer this process ever creates, not only the windows configured below.
app.enableSandbox();

const logger = createLogger({ directory: app.getPath('logs'), echo: !app.isPackaged });

let config;
try {
  config = loadAppConfig({ isPackaged: app.isPackaged });
} catch (error) {
  logger.error('config_invalid', { reason: error });
  dialog.showErrorBox('Virtex', error.message);
  app.exit(1);
  throw error;
}
const PORTAL_URL = config.portalUrl;
const POS_URL = config.posUrl;
const ALLOWED_ORIGINS = config.allowedOrigins;

// One running shell per user. A second launch focuses the existing window instead of opening a
// second session against the same local storage — and, on a till, a second POS on the same drawer.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Crash dumps are kept locally (Help → open logs folder) and uploaded only if the build names an
// HTTPS collector. Without one, a crash on a customer's machine is still diagnosable.
crashReporter.start({
  productName: 'Virtex Desktop',
  submitURL: config.crashReports.submitUrl ?? '',
  uploadToServer: Boolean(config.crashReports.submitUrl),
  compress: true,
  ignoreSystemCrashHandler: true,
  globalExtra: { commit: config.build.commit },
});

if (process.platform === 'win32') app.setAppUserModelId('io.virtex.desktop');

/** Hand a link to the operating system only if its scheme is one we allow (https, mailto). */
function openExternally(url) {
  if (policy.mayOpenExternally(url)) {
    shell.openExternal(url);
  } else {
    logger.warn('external_link_refused', { url });
  }
}

/** The IPC handlers act only for frames served from a trusted origin. */
function fromTrustedFrame(event) {
  const url = event.senderFrame ? event.senderFrame.url : '';
  return policy.isTrustedSender(url, ALLOWED_ORIGINS);
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

/**
 * The native menu's own catalogue, and the language it is drawn in.
 *
 * The menu and the native dialogs are drawn before (or outside) any page, so they cannot go through
 * `TranslateService`. `tools/i18n/build-catalogues.mjs` emits `src/i18n/<lang>.json` for the
 * `desktop` namespace from the same source as every other catalogue. The language comes from the
 * renderer (`vx-language` in localStorage), and the menu is rebuilt when it changes.
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
    // A missing catalogue must not stop the window opening.
    catalogues[language] = {};
  }
  return catalogues[language];
}

function t(key, params = {}) {
  const table = catalogue(menuLanguage);
  const fallback = catalogue(DEFAULT_LANGUAGE);
  const text = typeof table[key] === 'string' ? table[key] : typeof fallback[key] === 'string' ? fallback[key] : key;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

const updates = createUpdateController({
  app,
  // Required lazily: electron-updater reads app-update.yml on load, which only a packaged build has.
  get autoUpdater() {
    return require('electron-updater').autoUpdater;
  },
  fetch: (url, init) => net.fetch(url, init),
  dialog,
  powerMonitor,
  config,
  logger,
  t,
  getWindow: () => mainWindow,
});

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
      webSecurity: true,
      allowRunningInsecureContent: false,
      // The shell never shows a <webview>, and no page needs to spell-check through a remote service.
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
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
    if (!policy.isTrustedUrl(url, ALLOWED_ORIGINS)) {
      event.preventDefault();
      openExternally(url);
    }
  };
  mainWindow.webContents.on('will-navigate', guard);
  // A server redirect is a navigation too; without this a trusted page could be redirected off-origin.
  mainWindow.webContents.on('will-redirect', guard);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (policy.isTrustedUrl(url, ALLOWED_ORIGINS)) return { action: 'allow' };
    openExternally(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error('renderer_gone', { reason: details.reason, exitCode: details.exitCode });
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

function showAbout() {
  const options = {
    type: 'info',
    title: t('desktop.menu.about'),
    message: 'Virtex Desktop',
    detail: t('desktop.about.detail', {
      version: app.getVersion(),
      electron: process.versions.electron,
      commit: config.build.commit,
    }),
  };
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
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
        // Developer tools are a development aid; in an installed build they are a console into the
        // session of whoever is signed in.
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: t('desktop.menu.help'),
      role: 'help',
      submenu: [
        { label: t('desktop.menu.check_for_updates'), click: () => updates.check({ manual: true }) },
        { label: t('desktop.menu.open_logs'), click: () => shell.openPath(app.getPath('logs')) },
        { type: 'separator' },
        { label: t('desktop.menu.about'), click: () => showAbout() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Draw the menu in the language the renderer is using.
 *
 * Called on startup with whatever the last session stored, and again whenever the renderer reports a
 * change.
 */
function applyLanguage(language) {
  const next = SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  if (next === menuLanguage) return;
  menuLanguage = next;
  buildMenu();
}

ipcMain.on('virtex:language', (event, language) => {
  if (!fromTrustedFrame(event)) return;
  applyLanguage(String(language ?? ''));
});

//  Controles de ventana del topbar. La acción la ejecuta SIEMPRE el proceso
//  principal —el renderer no tiene ninguna capacidad sobre la ventana— y se
//  resuelve sobre la ventana que emite el evento, no sobre una referencia
//  global, para que siga siendo correcto si algún día hay más de una.
ipcMain.on('virtex:window-minimize', (event) => {
  if (!fromTrustedFrame(event)) return;
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('virtex:window-maximize-toggle', (event) => {
  if (!fromTrustedFrame(event)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('virtex:window-close', (event) => {
  if (!fromTrustedFrame(event)) return;
  BrowserWindow.fromWebContents(event.sender)?.close();
});

//  Estado inicial: el renderer lo pide al montar el topbar para dibujar el
//  icono correcto antes de la primera transición.
ipcMain.handle('virtex:window-is-maximized', (event) => {
  if (!fromTrustedFrame(event)) return false;
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

// Hardening that applies to every web contents the app ever creates, not only the main window.
app.on('web-contents-created', (_event, contents) => {
  // No <webview>: it would be a second, unguarded browser inside the shell.
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// A certificate the operating system rejects is never accepted, whatever the page asks. Electron
// already refuses it when this handler does not call `preventDefault()`; logging it is the point.
app.on('certificate-error', (_event, _contents, url, error) => {
  logger.error('certificate_rejected', { url, error });
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function hardenSession(target) {
  // Deny every permission (camera, microphone, geolocation, …) except a short list, and only to
  // the trusted origins.
  target.setPermissionRequestHandler((contents, permission, callback) => {
    callback(policy.mayGrantPermission(permission, contents.getURL(), ALLOWED_ORIGINS));
  });
  target.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    policy.mayGrantPermission(permission, requestingOrigin || (contents ? contents.getURL() : ''), ALLOWED_ORIGINS),
  );

  // The baseline CSP on every document the trusted origins serve.
  target.webRequest.onHeadersReceived(
    { urls: ALLOWED_ORIGINS.map((origin) => `${origin}/*`) },
    (details, callback) => {
      const isDocument = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
      callback({ responseHeaders: isDocument ? policy.withBaselineCsp(details.responseHeaders) : details.responseHeaders });
    },
  );

  // Optional public-key pinning for the configured hosts. -3 keeps Chromium's own verdict (the OS
  // trust store still applies); -2 rejects. Hosts outside the configuration are never pinned.
  const pins = config.tls.pinnedSpkiSha256;
  if (pins.length) {
    const hosts = policy.pinnedHosts(ALLOWED_ORIGINS);
    target.setCertificateVerifyProc((request, callback) => {
      if (!hosts.has(request.hostname) || request.verificationResult !== 'net::OK') return callback(-3);
      const chain = [];
      for (let cert = request.certificate; cert; cert = cert.issuerCert) {
        chain.push(cert.data);
        if (cert.issuerCert === cert) break;
      }
      if (policy.chainMatchesPins(chain, pins)) return callback(-3);
      logger.error('certificate_pin_mismatch', { host: request.hostname });
      return callback(-2);
    });
  }
}

app.whenReady().then(() => {
  hardenSession(session.defaultSession);
  buildMenu();
  createWindow();
  updates.start();
  logger.info('started', {
    version: app.getVersion(),
    electron: process.versions.electron,
    commit: config.build.commit,
    packaged: app.isPackaged,
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
