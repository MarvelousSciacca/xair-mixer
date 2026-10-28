// App per computer (macOS, Windows, Linux): il ponte WebSocket <-> UDP gira dentro l'app,
// solo su questo computer, e la finestra mostra la stessa interfaccia del browser.
// Porta fissa così le preferenze (salvate per indirizzo) restano tra un avvio e l'altro.

import { app, BrowserWindow, shell, Menu, session } from 'electron';
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
    title: 'AirDesk',
    backgroundColor: '#f4f4f4',
    icon: path.join(DIR, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  const origin = `http://127.0.0.1:${port}`;
  // la finestra mostra solo l'interfaccia dell'app: ogni altro indirizzo va nel browser di sistema,
  // e solo se è una normale pagina web (mai file locali o altri protocolli)
  const openOutside = url => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${origin}/`)) {
      e.preventDefault();
      openOutside(url);
    }
  });
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.loadURL(`${origin}/`);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(() => {
  // dei permessi del browser serve solo lo schermo acceso; microfono, fotocamera, posizione,
  // notifiche e il resto vengono sempre negati
  // schermo acceso e controller MIDI (senza sysex: solo note e controlli); tutto il resto negato
  const allowed = permission => permission === 'screen-wake-lock' || permission === 'midi';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  return createWindow();
});
app.on('window-all-closed', () => app.quit());
