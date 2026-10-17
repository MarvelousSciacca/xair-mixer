// Controlli dell'EQ pensati per chi non conosce le sigle: tipo di banda disegnato,
// zona dello spettro a parole e punti di partenza per gli strumenti più comuni.

import { SPEC, EQ_TYPES, toNorm, fromNorm } from './params.js';
import { EQ_ZONES } from './graphs.js';

const svgNS = 'http://www.w3.org/2000/svg';

// Forma della risposta di ogni tipo (28x16), nome in italiano.
export const EQ_TYPE_INFO = {
  LCut: { name: 'Taglio bassi', path: 'M2 15 C7 15 8 4 12 4 H26' },
  LShv: { name: 'Shelf bassi', path: 'M2 4 H8 C12 4 13 11 17 11 H26' },
  PEQ: { name: 'Campana', path: 'M2 12 H7 C10 12 10 3 14 3 C18 3 18 12 21 12 H26' },
  VEQ: { name: 'Campana vintage', path: 'M2 12 H9 C11 12 12 2 14 2 C16 2 17 12 19 12 H26' },
  HShv: { name: 'Shelf acuti', path: 'M2 11 H11 C15 11 16 4 20 4 H26' },
  HCut: { name: 'Taglio acuti', path: 'M2 4 H16 C20 4 21 15 26 15' },
};

/** Nome della zona dello spettro in cui cade una frequenza. */
export const zoneName = f => (EQ_ZONES.find(([lo, hi]) => f >= lo && f < hi) ?? EQ_ZONES.at(-1))[2];

function icon(path) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 28 17');
  svg.setAttribute('class', 'eq-type-ico');
  const p = document.createElementNS(svgNS, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

/** Pulsanti con la forma di ogni tipo di banda. */
export function eqTypePicker(scope, address, spec) {
  const wrap = document.createElement('div');
  wrap.className = 'eq-types';
  wrap.setAttribute('role', 'radiogroup');
  const buttons = spec.options.map((code, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = EQ_TYPE_INFO[code]?.name ?? code;
    b.setAttribute('aria-label', b.title);
    b.setAttribute('role', 'radio');
    b.append(icon(EQ_TYPE_INFO[code]?.path ?? ''));
    b.addEventListener('click', () => scope.set(address, spec, i));
    wrap.append(b);
    return b;
  });
  const name = document.createElement('div');
  name.className = 'eq-type-name';
  const render = v => {
    buttons.forEach((b, i) => b.setAttribute('aria-checked', String(i === v)));
    name.textContent = EQ_TYPE_INFO[spec.options[v]]?.name ?? '';
  };
  render(scope.get(address, spec));
  scope.on(address, render);
  const box = document.createElement('div');
  box.className = 'eq-type';
  box.append(wrap, name);
  return box;
}

// --- punti di partenza -----------------------------------------------------------------------
// Bande: [tipo, frequenza Hz, guadagno dB, Q]. lowCut: frequenza del low cut del preamp (null = spento).
const B = (type, f, g = 0, q = 2) => ({ type, f, g, q });
export const EQ_PRESETS = [
  { id: 'flat', name: 'Piatto', lowCut: null, bands: null },
  { id: 'voice', name: 'Voce', lowCut: 100, bands: [B('LShv', 150, -2), B('PEQ', 350, -3, 2), B('PEQ', 3000, 3, 1.4), B('HShv', 10000, 2)] },
  { id: 'acoustic', name: 'Chitarra acustica', lowCut: 80, bands: [B('LShv', 120, -4), B('PEQ', 250, -3, 2), B('PEQ', 2500, 2, 1.4), B('HShv', 8000, 3)] },
  { id: 'kick', name: 'Cassa', lowCut: null, bands: [B('PEQ', 60, 4, 1.4), B('PEQ', 350, -6, 2), B('PEQ', 4000, 4, 2), B('HShv', 10000, -3)] },
  { id: 'bass', name: 'Basso', lowCut: 40, bands: [B('LShv', 80, 2), B('PEQ', 250, -3, 1.4), B('PEQ', 800, 2, 2), B('HShv', 5000, -4)] },
];

// Bande "piatte": tipi e frequenze iniziali del mixer, guadagno 0.
const FLAT = {
  4: [B('LShv', 80), B('PEQ', 300), B('PEQ', 2000), B('HShv', 10000)],
  6: [B('LShv', 80), B('PEQ', 200), B('PEQ', 600), B('PEQ', 2000), B('PEQ', 6000), B('HShv', 12000)],
};

/**
 * Barra dei punti di partenza. I preset per strumento valgono per le strip a 4 bande;
 * "Piatto" per tutte. Dopo l'applicazione resta un pulsante Annulla per qualche secondo.
 */
export function eqPresetBar(scope, strip, params) {
  const bar = document.createElement('div');
  bar.className = 'eq-presets';
  const label = document.createElement('span');
  label.className = 'eq-presets-label';
  label.textContent = 'Punto di partenza';
  bar.append(label);
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'btn ghost eq-undo';
  undo.textContent = 'Annulla';
  undo.hidden = true;
  let saved = null;
  let timer = 0;

  const addresses = () => {
    const list = [`${strip.base}/eq/on`];
    for (let i = 1; i <= strip.eqBands; i++) for (const k of ['type', 'f', 'g', 'q']) list.push(`${strip.base}/eq/${i}/${k}`);
    if (strip.preamp) list.push(`${strip.base}/preamp/hpon`, `${strip.base}/preamp/hpf`);
    return list;
  };
  const apply = preset => {
    saved = addresses().map(a => [a, scope.get(a, params.get(a))]);
    const bands = preset.bands ?? FLAT[strip.eqBands];
    bands.forEach((b, i) => {
      const a = k => `${strip.base}/eq/${i + 1}/${k}`;
      scope.set(a('type'), params.get(a('type')), EQ_TYPES.indexOf(b.type));
      scope.set(a('f'), params.get(a('f')), toNorm(params.get(a('f')), b.f));
      scope.set(a('g'), SPEC.eqG, toNorm(SPEC.eqG, b.g));
      scope.set(a('q'), SPEC.eqQ, toNorm(SPEC.eqQ, b.q));
    });
    if (preset.bands) scope.set(`${strip.base}/eq/on`, SPEC.eqOn, 1);
    if (strip.preamp && preset.id !== 'flat') {
      scope.set(`${strip.base}/preamp/hpon`, SPEC.hpon, preset.lowCut ? 1 : 0);
      if (preset.lowCut) scope.set(`${strip.base}/preamp/hpf`, SPEC.hpf, toNorm(SPEC.hpf, preset.lowCut));
    }
    undo.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { undo.hidden = true; }, 15000);
  };
  undo.addEventListener('click', () => {
    saved?.forEach(([a, v]) => scope.set(a, params.get(a), v));
    saved = null;
    undo.hidden = true;
  });
  for (const p of EQ_PRESETS.filter(p => !p.bands || strip.eqBands === 4)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-btn';
    b.textContent = p.name;
    b.addEventListener('click', () => apply(p));
    bar.append(b);
  }
  bar.append(undo);
  scope.add(() => clearTimeout(timer));
  return bar;
}

/** Titolo della banda con la zona dello spettro, aggiornato quando cambia la frequenza. */
export function bandTitle(scope, address, spec, n) {
  const el = document.createElement('div');
  el.className = 'eq-band-title';
  const render = v => { el.textContent = `Banda ${n} · ${zoneName(fromNorm(spec, v))}`; };
  render(scope.get(address, spec));
  scope.on(address, render);
  return el;
}
