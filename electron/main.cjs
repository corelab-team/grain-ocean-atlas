const { app, BrowserWindow, Menu, protocol, session, powerSaveBlocker, dialog } = require('electron');
const path = require('node:path');
const { fileResponse, isAppURL, isAllowedRequest, validateAssets } = require('./files.cjs');

const verify = process.argv.includes('--verify');
const windowed = verify || process.argv.includes('--windowed');
let mainWindow;
let sleepBlocker;

protocol.registerSchemesAsPrivileged([{
  scheme: 'atlas', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.setName('Grain Export Atlas');
// A test instance must not disturb the exhibit's saved state or running window.
if (!verify) app.setPath('userData', path.join(app.getPath('appData'), 'grain-export-atlas'));
if (verify) app.setPath('userData', path.join(app.getPath('temp'), `grain-export-verify-${process.pid}`));

const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    const root = app.isPackaged ? path.join(process.resourcesPath, 'atlas') :
      path.resolve(__dirname, '../dist/export-only');
    await validateAssets(root);
    const localSession = session.fromPartition('atlas');
    localSession.protocol.handle('atlas', request => fileResponse(request, root));
    localSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isAllowedRequest(details.url) });
    });
    localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    localSession.setPermissionCheckHandler(() => false);
    localSession.on('will-download', event => event.preventDefault());
    Menu.setApplicationMenu(null);
    mainWindow = new BrowserWindow({
      width: 1920, height: 1080, minWidth: 960, minHeight: 540,
      title: 'Маршруты экспорта', backgroundColor: '#101c27',
      show: false, kiosk: !windowed, fullscreen: !windowed, autoHideMenuBar: true,
      webPreferences: {
        session: localSession, nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true, backgroundThrottling: false,
        devTools: !app.isPackaged || verify
      }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrictNavigation = (event, url) => {
      if (!isAppURL(url)) event.preventDefault();
    };
    mainWindow.webContents.on('will-navigate', restrictNavigation);
    mainWindow.webContents.on('will-redirect', restrictNavigation);
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'q') {
        event.preventDefault(); app.quit();
      }
    });
    mainWindow.once('ready-to-show', () => { if (!verify) mainWindow.show(); });
    mainWindow.on('closed', () => { mainWindow = null; });
    if (!verify) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
    await mainWindow.loadURL('atlas://app/index.html' + (verify ? '?idle=0' : ''));
  }).catch(error => {
    console.error(error);
    if (!verify) dialog.showErrorBox('Не удалось запустить приложение',
      'Проверьте, что приложение распаковано целиком вместе с папкой resources.\n\n' + error.message);
    app.exit(1);
  });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (sleepBlocker !== undefined && powerSaveBlocker.isStarted(sleepBlocker)) powerSaveBlocker.stop(sleepBlocker);
});
