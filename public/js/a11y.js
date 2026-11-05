// Accessibilità: annunci per gli screen reader (VoiceOver, TalkBack, NVDA…), cursori nativi
// nascosti sopra fader e manopole, dimensione dell'interfaccia e contrasto alto.

import { speak, speakValue } from './speech.js';
import { translate } from './i18n.js';

// --- annunci ---------------------------------------------------------------------------------------

let politeEl = null;
let urgentEl = null;
const liveRegion = urgent => {
  const el = document.createElement('div');
  el.className = 'sr-only';
  el.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');
  if (urgent) el.setAttribute('role', 'alert');
  document.body.append(el);
  return el;
};

/**
 * Fa leggere un messaggio allo screen reader senza spostare il focus. urgent: interrompe la lettura
 * in corso (feedback, connessione persa). Chi non usa uno screen reader non vede e non sente nulla.
 */
export function announce(text, { urgent = false } = {}) {
  if (!text || typeof document === 'undefined') return;
  const el = urgent ? (urgentEl ??= liveRegion(true)) : (politeEl ??= liveRegion(false));
  // svuotare e riscrivere dopo un attimo: lo stesso messaggio ripetuto viene letto di nuovo
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);
  speak(text, { urgent });
}

// --- cursore nativo per gli screen reader ----------------------------------------------------------

/**
 * Mette sopra un controllo disegnato (fader, pan, manopola) un <input type="range"> trasparente.
 * VoiceOver e TalkBack sanno regolare solo i cursori veri: scorrendo su/giù con un dito il valore
 * sale e scende di uno scatto. Il trascinamento col dito resta quello del controllo: mentre si
 * tocca, i cambi del cursore nascosto vengono ignorati.
 *
 * steps: numero di scatti (0…steps); index(): scatto attuale; pick(i): applica lo scatto i;
 * text(): valore da leggere ("-10 dB", "L25"…).
 */
export function srRange(host, { label, steps, index, pick, text }) {
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'sr-range';
  input.min = '0';
  input.max = String(steps);
  input.step = '1';
  let touching = false;
  host.addEventListener('pointerdown', () => { touching = true; });
  const say = final => speakValue(`${input.getAttribute('aria-label') ?? ''}, ${translate(text())}`, { final });
  const up = () => {
    if (touching) say(true);
    touching = false;
    sync();
  };
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  input.addEventListener('input', () => {
    if (touching) return sync();
    pick(Number(input.value));
    say(false);
  });
  const sync = () => {
    const i = String(Math.max(0, Math.min(steps, index())));
    if (input.value !== i) input.value = i;
    const t = text();
    if (input.getAttribute('aria-valuetext') !== t) {
      input.setAttribute('aria-valuetext', t);
      if (touching) say(false); // valore che cambia mentre lo trascini
    }
  };
  const setLabel = l => { if (input.getAttribute('aria-label') !== l) input.setAttribute('aria-label', l); };
  setLabel(label);
  host.append(input);
  sync();
  return { input, sync, setLabel };
}

/** Scatti del fader per gli screen reader: 1 dB vicino allo zero, più larghi in basso. */
export const FADER_STEPS_DB = [-Infinity, -80, -70, -60, -55, -50, -45, -40, -35,
  ...Array.from({ length: 41 }, (_, i) => -30 + i)];

export function nearestStep(list, v) {
  let best = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - v) < Math.abs(list[best] - v)) best = i;
  if (v === -Infinity) return 0;
  return best;
}

// --- aspetto: dimensione e contrasto ---------------------------------------------------------------

const SIZE_KEY = 'xair.uiSize';
const CONTRAST_KEY = 'xair.contrast';
export const UI_SIZES = [['1', 'Normale'], ['1.15', 'Grande'], ['1.3', 'Più grande'], ['1.5', 'Massima']];
export const CONTRASTS = [['auto', 'Automatico'], ['more', 'Alto'], ['normal', 'Normale']];

const read = (key, def) => {
  try { return localStorage.getItem(key) || def; } catch { return def; }
};
const write = (key, v) => {
  try { localStorage.setItem(key, v); } catch { /* non disponibile */ }
};
const contrastQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-contrast: more)') : null;

export const currentUiSize = () => read(SIZE_KEY, '1');
export const currentContrast = () => read(CONTRAST_KEY, 'auto');

// Le regole @media guardano la finestra vera e non sanno dello zoom: con l'interfaccia al 150% una
// finestra di 1200 px ha posto per 800 px di contenuto, ma resterebbe la disposizione "da 1200".
// Si moltiplicano allora le soglie (max-width: 700px → 1050px…) per lo zoom, così la disposizione
// è quella giusta per lo spazio che resta davvero, senza dover ridimensionare la finestra.
const mediaOriginal = new WeakMap();
const SIZE_FEATURE = /((?:min|max)-(?:width|height)\s*:\s*)([\d.]+)px/g;
function scaleMediaRules(rules, zoom) {
  for (const rule of rules) {
    if (rule.media && rule.cssRules) {
      if (!mediaOriginal.has(rule)) mediaOriginal.set(rule, rule.media.mediaText);
      const original = mediaOriginal.get(rule);
      const text = zoom === 1 ? original : original.replace(SIZE_FEATURE, (m, feature, px) => `${feature}${Math.round(Number(px) * zoom)}px`);
      if (rule.media.mediaText !== text) rule.media.mediaText = text;
    }
    if (rule.cssRules) scaleMediaRules(rule.cssRules, zoom);
  }
}
function scaleMediaQueries(zoom) {
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // fogli di altri siti: non leggibili
    if (rules) scaleMediaRules(rules, zoom);
  }
}

/** Zoom dell'interfaccia attuale (1 = normale). */
export const uiZoom = () => Number(document.documentElement.dataset.uiSize) || 1;

/** Applica dimensione e contrasto salvati (o scelti ora). */
export function applyAppearance() {
  const root = document.documentElement;
  const size = Number(currentUiSize()) || 1;
  // zoom su tutta l'interfaccia: testi, tasti e fader crescono insieme e restano proporzionati
  root.style.zoom = size === 1 ? '' : String(size);
  root.dataset.uiSize = String(size);
  scaleMediaQueries(size);
  // Chrome (app per computer, Android) ingrandisce anche le misure legate alla finestra (100vh…),
  // Safari no: si misura e, se serve, i fogli di stile le dividono per --vu.
  root.style.removeProperty('--vu');
  if (size !== 1 && document.body) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none';
    document.body.append(probe);
    const scaled = probe.offsetHeight * size > window.innerHeight * 1.1;
    probe.remove();
    if (scaled) root.style.setProperty('--vu', String(size));
  }
  const c = currentContrast();
  root.dataset.contrast = c === 'more' || (c === 'auto' && contrastQuery?.matches) ? 'more' : 'normal';
}
export function setUiSize(v) {
  write(SIZE_KEY, v);
  applyAppearance();
  window.dispatchEvent(new window.Event('resize')); // fader e grafici si rimisurano
}
export function setContrast(v) {
  write(CONTRAST_KEY, v);
  applyAppearance();
}
contrastQuery?.addEventListener?.('change', applyAppearance);
