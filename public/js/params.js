// Definizione dei parametri di elaborazione (preamp, gate, EQ, compressore) e conversioni.
// I parametri continui viaggiano in OSC come float 0..1; enum e interruttori come interi.
// Usato sia dall'interfaccia sia dal simulatore.

import { faderToDb, formatDb } from './mixer.js';

const pad2 = n => String(n).padStart(2, '0');

export const EQ_TYPES = ['LCut', 'LShv', 'PEQ', 'VEQ', 'HShv', 'HCut'];
export const RATIOS = ['1.1', '1.3', '1.5', '2.0', '2.5', '3.0', '4.0', '5.0', '7.0', '10', '20', '100'];
export const FILTER_TYPES = ['LC6', 'LC12', 'HC6', 'HC12', '1.0', '2.0', '3.0', '5.0', '10.0'];
export const GATE_MODES = ['EXP2', 'EXP3', 'EXP4', 'GATE', 'DUCK'];
export const SEND_TAPS = ['IN', 'PRE EQ', 'POST EQ', 'PRE', 'POST', 'GRP'];

const lin = (label, min, max, unit, def, extra = {}) => ({ kind: 'lin', label, min, max, unit, def, ...extra });
const log = (label, min, max, unit, def, extra = {}) => ({ kind: 'log', label, min, max, unit, def, ...extra });
const enm = (label, options, def) => ({ kind: 'enum', label, options, def });
const bool = (label, def = 0) => ({ kind: 'bool', label, def });

export const SPEC = {
  gain: lin('Gain', -12, 60, 'dB', 0),
  phantom: bool('+48V'),
  invert: bool('Ø Fase'),
  hpon: bool('Low Cut'),
  hpf: log('Low Cut', 20, 400, 'Hz', 80),

  gate: {
    on: bool('Gate'),
    mode: enm('Modo', GATE_MODES, 3),
    thr: lin('Soglia', -80, 0, 'dB', -40),
    range: lin('Range', 3, 60, 'dB', 30),
    attack: lin('Attacco', 0, 120, 'ms', 10),
    hold: log('Hold', 0.02, 2000, 'ms', 50),
    release: log('Rilascio', 5, 4000, 'ms', 200),
    'filter/on': bool('Filtro key'),
    'filter/type': enm('Tipo filtro', FILTER_TYPES, 6),
    'filter/f': log('Freq. filtro', 20, 20000, 'Hz', 1000),
  },

  dyn: {
    on: bool('Comp'),
    mode: enm('Modo', ['COMP', 'EXP'], 0),
    det: enm('Rilevamento', ['PEAK', 'RMS'], 0),
    env: enm('Inviluppo', ['LIN', 'LOG'], 1),
    thr: lin('Soglia', -60, 0, 'dB', -20),
    ratio: enm('Ratio', RATIOS, 5),
    knee: lin('Knee', 0, 5, '', 2, { step: 1 }),
    mgain: lin('Make-up', 0, 24, 'dB', 0),
    attack: lin('Attacco', 0, 120, 'ms', 10),
    hold: log('Hold', 0.02, 2000, 'ms', 10),
    release: log('Rilascio', 5, 4000, 'ms', 150),
    mix: lin('Mix', 0, 100, '%', 100),
    auto: bool('Auto'),
    'filter/on': bool('Filtro key'),
    'filter/type': enm('Tipo filtro', FILTER_TYPES, 6),
    'filter/f': log('Freq. filtro', 20, 20000, 'Hz', 1000),
  },

  // Sorgente d'ingresso (indirizzi verificati su XR18V2; valori 0 = In 1 / USB 1).
  rtnsw: enm('Sorgente', ['Analogico', 'USB'], 0),
  insrc: def => enm('Ingresso', Array.from({ length: 16 }, (_, i) => `In ${i + 1}`), def),
  rtnsrc: def => enm('Ritorno USB', Array.from({ length: 18 }, (_, i) => `USB ${i + 1}`), def),
  auxRtnsrc: enm('Ritorno USB', Array.from({ length: 9 }, (_, i) => `USB ${2 * i + 1}-${2 * i + 2}`), 8),
  rtntrim: lin('Trim USB', -18, 18, 'dB', 0, { bipolar: true }), // indirizzo verificato (0.5 = 0 dB), estremi da verificare

  // Automix: gruppo (OFF, X, Y) e peso del canale (0.5 = 0 dB, verificato).
  amixGroup: enm('Automix', ['OFF', 'X', 'Y'], 0),
  amixWeight: lin('Peso', -12, 12, 'dB', 0, { bipolar: true }),
  amixEnable: bool('Attivo'),

  eqOn: bool('EQ'),
  eqType: def => enm('Tipo', EQ_TYPES, def),
  eqF: def => log('Freq', 20, 20000, 'Hz', def),
  eqG: lin('Gain', -15, 15, 'dB', 0, { bipolar: true }),
  eqQ: log('Q', 10, 0.3, '', 2),

  // Mandate: il livello usa la stessa legge del fader (0..1 -> -∞..+10 dB).
  send: { kind: 'fader', label: 'Livello', def: 0 },
  tap: def => enm('Prelievo', SEND_TAPS, def),
  lr: bool('Main LR', 1),
  insertOn: bool('Insert'),
  insertSlot: enm('Slot', ['FX1', 'FX2', 'FX3', 'FX4'], 0),
  // Gruppi: maschera di bit, bit 0 = DCA/mute group 1.
  dcaMask: { kind: 'bits', label: 'DCA', def: 0 },
  muteMask: { kind: 'bits', label: 'Mute group', def: 0 },
};

// Impostazioni iniziali delle bande (tipo, frequenza).
const EQ_DEFAULTS = {
  4: [[1, 80], [2, 300], [2, 2000], [4, 10000]],
  6: [[1, 80], [2, 200], [2, 600], [2, 2000], [2, 6000], [4, 12000]],
};

// --- conversioni -------------------------------------------------------------------

export const isContinuous = spec => spec.kind === 'lin' || spec.kind === 'log' || spec.kind === 'fader';
export const oscType = spec => (isContinuous(spec) ? 'f' : 'i'); // enum, bool, bits, int

export function fromNorm(spec, v) {
  if (spec.kind === 'lin') {
    const x = spec.min + v * (spec.max - spec.min);
    return spec.step ? Math.round(x / spec.step) * spec.step : x;
  }
  if (spec.kind === 'log') return spec.min * (spec.max / spec.min) ** v;
  return v;
}

export function toNorm(spec, x) {
  if (spec.kind === 'lin') return (x - spec.min) / (spec.max - spec.min);
  if (spec.kind === 'log') return Math.log(x / spec.min) / Math.log(spec.max / spec.min);
  return x;
}

export const defaultValue = spec => (isContinuous(spec) ? toNorm(spec, spec.def) : spec.def);

export function formatReal(unit, x) {
  switch (unit) {
    case 'Hz':
      return x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 1 : 2)}k` : `${Math.round(x)}`;
    case 's':
      return x.toFixed(2);
    case 'x':
      return x.toFixed(2);
    case 'ms':
      return x < 1 ? x.toFixed(2) : x < 10 ? x.toFixed(1) : `${Math.round(x)}`;
    case 'dB':
      return `${x > 0.05 ? '+' : ''}${x.toFixed(1)}`;
    case '%':
      return `${Math.round(x)}`;
    default:
      return x < 10 ? x.toFixed(1) : `${Math.round(x)}`;
  }
}

export function formatValue(spec, v) {
  if (spec.kind === 'enum') return spec.options[Math.round(v)] ?? '?';
  if (spec.kind === 'bool') return v ? 'ON' : 'OFF';
  if (spec.kind === 'fader') return `${formatDb(faderToDb(v))} dB`;
  if (spec.kind === 'bits') return v.toString(2).padStart(4, '0');
  const x = fromNorm(spec, v);
  return `${formatReal(spec.unit, x)}${spec.unit && spec.unit !== '%' ? ` ${spec.unit}` : spec.unit}`;
}

// --- parametri di ogni strip ---------------------------------------------------------

/** Elenco { address, spec } dei parametri di elaborazione di una strip. */
export function stripParams(strip) {
  const list = [];
  const add = (address, spec) => list.push({ address, spec });
  const { base } = strip;

  if (strip.headamp) {
    const h = `/headamp/${pad2(strip.headamp)}`;
    add(`${h}/gain`, SPEC.gain);
    add(`${h}/phantom`, SPEC.phantom);
  }
  if (strip.source === 'ch') {
    add(`${base}/preamp/rtnsw`, SPEC.rtnsw);
    add(`${base}/config/insrc`, SPEC.insrc(strip.headamp - 1));
    add(`${base}/config/rtnsrc`, SPEC.rtnsrc(strip.headamp - 1));
    add(`${base}/preamp/rtntrim`, SPEC.rtntrim);
  } else if (strip.source === 'aux') {
    add(`${base}/preamp/rtnsw`, SPEC.rtnsw);
    add(`${base}/config/rtnsrc`, SPEC.auxRtnsrc);
    add(`${base}/preamp/rtntrim`, SPEC.rtntrim);
  }
  if (strip.automix) {
    add(`${base}/automix/group`, SPEC.amixGroup);
    add(`${base}/automix/weight`, SPEC.amixWeight);
  }
  if (strip.preamp) {
    add(`${base}/preamp/invert`, SPEC.invert);
    add(`${base}/preamp/hpon`, SPEC.hpon);
    add(`${base}/preamp/hpf`, SPEC.hpf);
  }
  if (strip.lrAssign) add(`${base}/mix/lr`, SPEC.lr);
  if (strip.insert) {
    add(`${base}/insert/on`, SPEC.insertOn);
    add(`${base}/insert/sel`, SPEC.insertSlot);
  }
  for (let n = 1; n <= (strip.sends ?? 0); n++) {
    add(sendAddress(strip, n), SPEC.send);
    add(`${base}/mix/${pad2(n)}/tap`, SPEC.tap(n <= 6 ? 3 : 4)); // bus: PRE, effetti: POST
  }
  if (strip.groups) {
    add(`${base}/grp/dca`, SPEC.dcaMask);
    add(`${base}/grp/mute`, SPEC.muteMask);
  }
  if (strip.gate) for (const [k, spec] of Object.entries(SPEC.gate)) add(`${base}/gate/${k}`, spec);
  if (strip.dyn) for (const [k, spec] of Object.entries(SPEC.dyn)) add(`${base}/dyn/${k}`, spec);
  if (strip.eqBands) {
    add(`${base}/eq/on`, SPEC.eqOn);
    EQ_DEFAULTS[strip.eqBands].forEach(([type, f], i) => {
      const b = `${base}/eq/${i + 1}`;
      add(`${b}/type`, SPEC.eqType(type));
      add(`${b}/f`, SPEC.eqF(f));
      add(`${b}/g`, SPEC.eqG);
      add(`${b}/q`, SPEC.eqQ);
    });
  }
  return list;
}

/** Mandata n (1-6 bus, 7-10 effetti). */
export const sendAddress = (strip, n) => `${strip.base}/mix/${pad2(n)}/level`;

/** Mappa indirizzo -> spec, comoda per costruire i controlli. */
export function paramMap(strip) {
  return new Map(stripParams(strip).map(p => [p.address, p.spec]));
}
