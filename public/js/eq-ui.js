// Controlli dell'EQ pensati per chi non conosce le sigle: tipo di banda disegnato,
// zona dello spettro a parole e punti di partenza per gli strumenti più comuni.

import { fromNorm } from './params.js';
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

/** Titolo della banda con la zona dello spettro, aggiornato quando cambia la frequenza. */
export function bandTitle(scope, address, spec, n) {
  const el = document.createElement('div');
  el.className = 'eq-band-title';
  const render = v => { el.textContent = `Banda ${n} · ${zoneName(fromNorm(spec, v))}`; };
  render(scope.get(address, spec));
  scope.on(address, render);
  return el;
}
