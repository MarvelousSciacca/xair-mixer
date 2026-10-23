// App per computer (macOS, Windows, Linux): il ponte WebSocket <-> UDP gira dentro l'app,
// solo su questo computer, e la finestra mostra la stessa interfaccia del browser.
// Porta fissa così le preferenze (salvate per indirizzo) restano tra un avvio e l'altro.

import { app, BrowserWindow, shell, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBridge } from './server/bridge.js';

const PORT = 47824;
const DIR = path.dirname(fileURLToPath(import.meta.url));

let win = null;
if (!app.requestSingleInstanceLock()) app.quit(); // una sola copia: la porta è una sola

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = startBridge({ port, host: '127.0.0.1', quiet: true });
    server.once('listening', () => resolve(server.address().port));
    server.once('error', reject);
  });
}

async function createWindow() {
  // se la porta è occupata da un altro programma si usa una porta libera qualsiasi
  const port = await listen(PORT).catch(() => listen(0));
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 760,
    minHeight: 520,
    title: 'X Air Mixer',
    backgroundColor: '#f4f4f4',
    icon: path.join(DIR, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  return createWindow();
});
app.on('window-all-closed', () => app.quit());
