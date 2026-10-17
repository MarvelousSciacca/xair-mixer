// EQ grafico (GEQ e TruEQ negli slot effetto): 31 cursori verticali per ogni lato.
// Si può trascinare in orizzontale sopra i cursori per "disegnare" la curva.

import { fxParamAddress } from './fx.js';
import { fromNorm, toNorm, formatValue } from './params.js';

const clamp = v => Math.min(1, Math.max(0, v));
export const GEQ_CODES = new Set(['GEQ', 'GEQ2', 'TEQ', 'TEQ2']);

/** Frequenze leggibili: '1k25' -> '1.25k'. */
const freqLabel = label => label.replace(/ [AB]$/, '').replace(/^(\d+)k(\d+)$/, '$1.$2k');

/**
 * Banchi di cursori per un effetto GEQ. `params` è l'elenco dei parametri dell'effetto
 * (31 bande + livello, ripetuto per il lato B negli effetti doppi).
 */
export function geqControls(scope, slot, params) {
  const root = document.createElement('div');
  root.className = 'geq';
  const sides = params.length > 32 ? [['A', 0], ['B', 32]] : [['', 0]];
  for (const [side, offset] of sides) {
    const bank = document.createElement('div');
    bank.className = 'geq-bank';
    const head = document.createElement('div');
    head.className = 'geq-head';
    const title = document.createElement('strong');
    title.textContent = side ? `Lato ${side}` : 'EQ grafico';
    const flat = document.createElement('button');
    flat.type = 'button';
    flat.className = 'btn ghost geq-flat';
    flat.textContent = 'Azzera';
    head.append(title, flat);

    const sliders = document.createElement('div');
    sliders.className = 'geq-sliders';
    const bands = [];
    for (let i = 0; i <= 31; i++) {
      const spec = params[offset + i];
      const address = fxParamAddress(slot, offset + i);
      const col = document.createElement('div');
      col.className = `geq-band${i === 31 ? ' level' : ''}`;
      col.innerHTML = '<div class="geq-track"><div class="geq-fill"></div><div class="geq-thumb"></div></div><span class="geq-label"></span>';
      col.querySelector('.geq-label').textContent = i === 31 ? 'Liv.' : freqLabel(spec.label);
      const render = v => {
        col.style.setProperty('--v', v);
        col.title = `${i === 31 ? 'Livello' : `${freqLabel(spec.label)} Hz`}: ${formatValue(spec, v)}`;
      };
      render(scope.get(address, spec));
      scope.on(address, render);
      col.addEventListener('dblclick', () => scope.set(address, spec, toNorm(spec, 0)));
      (i === 31 ? bank : sliders).append(col);
      bands.push({ col, spec, address });
    }
    const level = bands[31].col;

    // trascinamento: la banda sotto il dito prende il valore dell'altezza del dito
    const paint = (e, list) => {
      for (const b of list) {
        const r = b.col.querySelector('.geq-track').getBoundingClientRect();
        if (e.clientX < r.left - 2 || e.clientX > r.right + 2) continue;
        const v = clamp(1 - (e.clientY - r.top) / r.height);
        const db = Math.round(fromNorm(b.spec, v) * 2) / 2; // passi da 0.5 dB
        scope.set(b.address, b.spec, toNorm(b.spec, db));
      }
    };
    const drag = (el, list) => {
      let active = false;
      el.addEventListener('pointerdown', e => {
        active = true;
        el.setPointerCapture?.(e.pointerId);
        paint(e, list);
      });
      el.addEventListener('pointermove', e => { if (active) paint(e, list); });
      const end = () => { active = false; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    };
    drag(sliders, bands.slice(0, 31));
    drag(level, [bands[31]]);
    flat.addEventListener('click', () => bands.slice(0, 31).forEach(b => scope.set(b.address, b.spec, toNorm(b.spec, 0))));

    const body = document.createElement('div');
    body.className = 'geq-body';
    const scale = document.createElement('div');
    scale.className = 'geq-scale';
    scale.innerHTML = '<span>+15</span><span>0</span><span>-15</span>';
    body.append(scale, sliders, level);
    bank.prepend(head);
    bank.append(body);
    root.append(bank);
  }
  const hint = document.createElement('p');
  hint.className = 'eq-hint';
  hint.textContent = 'Trascina sopra i cursori per disegnare la curva. Doppio tocco su un cursore: 0 dB.';
  root.append(hint);
  return root;
}
