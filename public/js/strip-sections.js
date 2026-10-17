// Sezioni opzionali della channel strip (come nel mixer di X-AIR-Edit): preamp, gate, compressore,
// EQ e mandate in miniatura. Quali mostrare lo decide la "Vista"; quanto spazio occupano lo decide
// la densità (piena / compatta / mini) calcolata in base all'altezza disponibile.
// Un tocco su una sezione apre il pannello di elaborazione sulla scheda giusta.

import { SPEC, paramMap, fromNorm, defaultValue, sendAddress } from './params.js';
import { stripFilters, responseDb } from './dsp.js';
import { dynTransfer } from './graphs.js';

const NS = 'http://www.w3.org/2000/svg';
const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Sezioni disponibili, nell'ordine in cui compaiono sulla strip. */
export const SECTIONS = [
  { id: 'preamp', label: 'Gain', tab: 'input', has: s => !!(s.headamp || s.source) },
  { id: 'gate', label: 'Gate', tab: 'gate', has: s => !!s.gate },
  { id: 'dyn', label: 'Comp', tab: 'dyn', has: s => !!s.dyn },
  { id: 'eq', label: 'EQ', tab: 'eq', has: s => !!s.eqBands },
  { id: 'sends', label: 'Mandate', tab: 'sends', has: s => !!s.sends },
];

/** Altezza (px) di ogni sezione per densità: serve a scegliere la densità che ci sta. */
export const SECTION_HEIGHT = {
  full: { preamp: 38, gate: 44, dyn: 44, eq: 48, sends: 40 },
  compact: { preamp: 24, gate: 26, dyn: 26, eq: 30, sends: 22 },
  mini: { preamp: 20, gate: 0, dyn: 0, eq: 0, sends: 0 }, // gate/comp/EQ diventano tasti su una riga
};
export const MINI_ROW = 22;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
function svg(viewBox, className) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('preserveAspectRatio', 'none');
  s.setAttribute('class', className);
  return s;
}
function path(parent, className) {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('class', className);
  p.setAttribute('vector-effect', 'non-scaling-stroke');
  parent.append(p);
  return p;
}

export function createStripSections(mixer, strip, { onProcess }) {
  const root = el('div', 'strip-sections');
  const params = paramMap(strip);
  const raw = a => mixer.get(a) ?? (params.has(a) ? defaultValue(params.get(a)) : undefined);
  const real = (a, spec = params.get(a)) => fromNorm(spec, raw(a));
  const renders = [];
  let frame = 0;
  const schedule = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      renders.forEach(r => r());
    });
  };

  const section = def => {
    const b = el('button', `sec sec-${def.id}`);
    b.type = 'button';
    b.dataset.sec = def.id;
    b.title = `${def.label}: tocca per aprire`;
    b.addEventListener('click', () => onProcess(strip, def.tab));
    const head = el('span', 'sec-head');
    const name = el('span', 'sec-name', def.label);
    name.dataset.short = { gate: 'G', dyn: 'C' }[def.id] ?? def.label;
    const value = el('span', 'sec-value');
    head.append(name, value);
    b.append(head);
    root.append(b);
    return { b, value };
  };

  // --- preamp: guadagno e indicatori ----------------------------------------------------
  if (SECTIONS[0].has(strip)) {
    const { b, value } = section(SECTIONS[0]);
    const flags = el('span', 'sec-flags');
    const bar = el('span', 'sec-bar');
    bar.append(el('span', 'sec-bar-fill'));
    b.append(bar, flags);
    const ha = strip.headamp ? `/headamp/${pad2(strip.headamp)}` : null;
    renders.push(() => {
      const usb = strip.source && raw(`${strip.base}/preamp/rtnsw`);
      if (ha && !usb) {
        const g = real(`${ha}/gain`, SPEC.gain);
        value.textContent = `${g > 0 ? '+' : ''}${Math.round(g)}`;
        b.style.setProperty('--fill', String((g + 12) / 72));
      } else {
        value.textContent = usb ? 'USB' : '';
        b.style.setProperty('--fill', '0');
      }
      flags.innerHTML = '';
      const flag = (text, on, cls = '') => { if (on) flags.append(el('span', `flag ${cls}`, text)); };
      flag('48V', ha && raw(`${ha}/phantom`), 'warn');
      flag('LC', strip.preamp && raw(`${strip.base}/preamp/hpon`));
      flag('Ø', strip.preamp && raw(`${strip.base}/preamp/invert`));
      flag('USB', usb, 'usb');
      b.classList.toggle('on', true);
    });
    if (ha) ['gain', 'phantom'].forEach(k => mixer.on(`${ha}/${k}`, schedule));
    ['preamp/hpon', 'preamp/invert', 'preamp/rtnsw'].forEach(k => mixer.on(`${strip.base}/${k}`, schedule));
  }

  // --- gate e compressore: curva di trasferimento in miniatura ------------------------------
  for (const kind of ['gate', 'dyn']) {
    const def = SECTIONS.find(s => s.id === kind);
    if (!def.has(strip)) continue;
    const { b, value } = section(def);
    const g = svg('0 0 100 100', 'sec-graph');
    const unity = path(g, 'sec-unity');
    unity.setAttribute('d', 'M0 100 L100 0');
    const thrLine = path(g, 'sec-thr');
    const curve = path(g, 'sec-curve');
    b.append(g);
    const base = `${strip.base}/${kind}`;
    const spec = SPEC[kind];
    const get = k => raw(`${base}/${k}`) ?? defaultValue(spec[k]);
    const realK = k => fromNorm(spec[k], get(k));
    const lo = kind === 'gate' ? -80 : -60;
    const P = db => ((clamp(db, lo, 0) - lo) / -lo) * 100;
    renders.push(() => {
      const transfer = dynTransfer(kind, get, realK);
      let d = '';
      for (let i = 0; i <= 30; i++) {
        const input = lo + (i / 30) * -lo;
        d += `${i ? 'L' : 'M'}${P(input).toFixed(1)} ${(100 - P(transfer(input))).toFixed(1)}`;
      }
      curve.setAttribute('d', d);
      const x = P(realK('thr')).toFixed(1);
      thrLine.setAttribute('d', `M${x} 0 L${x} 100`);
      const thr = Math.round(realK('thr'));
      value.textContent = `${thr}`;
      if (kind === 'dyn') b.title = `Compressore: soglia ${thr} dB, ratio ${['1.1', '1.3', '1.5', '2', '2.5', '3', '4', '5', '7', '10', '20', '∞'][get('ratio')] ?? ''}:1 — tocca per aprire`;
      b.classList.toggle('on', !!get('on'));
    });
    for (const k of Object.keys(spec)) mixer.on(`${base}/${k}`, schedule);
  }

  // --- EQ: curva di risposta ---------------------------------------------------------------
  if (strip.eqBands) {
    const { b, value } = section(SECTIONS[3]);
    const g = svg('0 0 100 40', 'sec-graph sec-eq-graph');
    const zero = path(g, 'sec-unity');
    zero.setAttribute('d', 'M0 20 L100 20');
    const fill = path(g, 'sec-fill');
    const curve = path(g, 'sec-curve');
    b.append(g);
    renders.push(() => {
      const filters = stripFilters(strip, a => mixer.get(a));
      let d = '';
      for (let i = 0; i <= 40; i++) {
        const f = 20 * 1000 ** (i / 40);
        const y = 20 - clamp(responseDb(filters, f), -18, 18) * (18 / 18);
        d += `${i ? 'L' : 'M'}${(i * 2.5).toFixed(1)} ${y.toFixed(1)}`;
      }
      curve.setAttribute('d', d);
      fill.setAttribute('d', `${d} L100 20 L0 20 Z`);
      const on = !!raw(`${strip.base}/eq/on`);
      b.classList.toggle('on', on);
      value.textContent = on ? '' : 'off';
    });
    for (const a of params.keys()) if (a.includes('/eq/') || a.includes('/preamp/hp')) mixer.on(a, schedule);
  }

  // --- mandate: barrette verso bus 1-6 ed effetti -------------------------------------------
  if (strip.sends) {
    const { b } = section(SECTIONS[4]);
    const bars = el('span', 'sec-sends');
    const items = [];
    for (let n = 1; n <= strip.sends; n++) {
      const bar = el('span', `sec-send${n > 6 ? ' fx' : ''}`);
      bar.append(el('span'));
      bars.append(bar);
      items.push({ bar, address: sendAddress(strip, n) });
      mixer.on(sendAddress(strip, n), schedule);
    }
    b.append(bars);
    renders.push(() => {
      for (const { bar, address } of items) bar.style.setProperty('--v', String(raw(address) ?? 0));
      b.classList.add('on');
    });
  }

  schedule();
  return root;
}
