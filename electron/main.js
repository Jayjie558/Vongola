const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const path = require('path');
const { createStaticServer } = require('./static-server');

let server = null;
let win = null;

function wirePermissions() {
  const allowMedia = (permission) => permission === 'media';
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allowMedia(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowMedia(permission));
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'GloveAR · VONGOLA 手套实时叠加',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  win.once('ready-to-show', () => {
    if (process.env.GLOVEAR_TEST_HIDDEN !== '1') win.show();
  });
  win.on('closed', () => { win = null; });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

app.setAppUserModelId('com.jayjie.glovear');
Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  wirePermissions();
  try {
    const started = await createStaticServer({ root: app.getAppPath() });
    server = started.server;
    createWindow(started.port);
  } catch (err) {
    dialog.showErrorBox('GloveAR 启动失败', err.message || String(err));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) {
      createWindow(server.address().port);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (server) server.close();
});
