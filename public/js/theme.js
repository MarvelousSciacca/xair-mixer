// Tema dell'interfaccia: chiaro (predefinito), scuro o automatico (segue il sistema).
// Il tema viene applicato già nell'<head> di index.html, prima che la pagina sia disegnata.

import { Capacitor, SystemBars, SystemBarsStyle } from '../vendor/capacitor-core.js';

const KEY = 'xair.theme';
export const THEMES = [['light', 'Chiaro'], ['dark', 'Scuro'], ['auto', 'Automatico']];

const stored = () => {
  try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; }
};
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const resolve = choice => (choice === 'auto' ? (darkQuery?.matches ? 'dark' : 'light') : choice);

export function applyTheme(choice = stored()) {
  const theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f4f4' : '#111317');
  // nelle app: icone della barra di stato scure sul tema chiaro, chiare sul tema scuro
  if (Capacitor.isNativePlatform()) {
    SystemBars.setStyle({ style: theme === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
  }
}

export function setTheme(choice) {
  try { localStorage.setItem(KEY, choice); } catch { /* non disponibile */ }
  applyTheme(choice);
}

export const currentTheme = stored;

darkQuery?.addEventListener?.('change', () => { if (stored() === 'auto') applyTheme(); });
