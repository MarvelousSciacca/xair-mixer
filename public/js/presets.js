// Preset come punto di partenza: EQ e "canale completo" (low cut, gate, compressore, EQ).
// Si scelgono da un menu a tendina; dopo l'applicazione restano Annulla (torna a com'era) e
// Reset (canale neutro). Sono valori tipici per il live: vanno rifiniti a orecchio col segnale vero.

import { EQ_TYPES, toNorm, defaultValue } from './params.js';
import { ask, notify } from './dialogs.js';

// --- EQ (4 bande) -------------------------------------------------------------------------------
// Banda: [tipo, frequenza Hz, guadagno dB, Q]. Gli shelf usano Q 0.7 (curva dolce, senza gobbe).
const S = 0.7;
export const EQ_PRESETS = {
  voice: { name: 'Voce', bands: [['LShv', 150, -2, S], ['PEQ', 350, -3, 1.2], ['PEQ', 3000, 2.5, 1], ['HShv', 10000, 2, S]] },
  speech: { name: 'Parlato', bands: [['LShv', 180, -3, S], ['PEQ', 400, -2, 1.2], ['PEQ', 2500, 3, 1], ['HShv', 8000, 1, S]] },
  choir: { name: 'Cori', bands: [['LShv', 200, -3, S], ['PEQ', 400, -3, 1.2], ['PEQ', 3500, 1.5, 1], ['HShv', 10000, 2, S]] },
  acoustic: { name: 'Chitarra acustica', bands: [['LShv', 120, -3, S], ['PEQ', 220, -3, 1.2], ['PEQ', 3000, 2, 1], ['HShv', 10000, 2, S]] },
  electric: { name: 'Chitarra elettrica', bands: [['LShv', 120, -2, S], ['PEQ', 400, -2, 1.2], ['PEQ', 2500, 2, 1.2], ['HShv', 8000, -2, S]] },
  bass: { name: 'Basso', bands: [['LShv', 80, 2, S], ['PEQ', 250, -3, 1.2], ['PEQ', 800, 1.5, 1.2], ['HShv', 5000, -3, S]] },
  kick: { name: 'Cassa', bands: [['PEQ', 60, 3, 1.4], ['PEQ', 350, -5, 1.4], ['PEQ', 3500, 3, 1.4], ['HShv', 10000, -3, S]] },
  snare: { name: 'Rullante', bands: [['PEQ', 200, 2, 1.4], ['PEQ', 500, -3, 1.4], ['PEQ', 5000, 2, 1.2], ['HShv', 10000, 1, S]] },
  tom: { name: 'Tom', bands: [['PEQ', 100, 2, 1.4], ['PEQ', 400, -4, 1.4], ['PEQ', 4000, 2, 1.4], ['HShv', 10000, -2, S]] },
  overhead: { name: 'Overhead / piatti', bands: [['LShv', 200, -2, S], ['PEQ', 500, -2, 1.2], ['PEQ', 4000, 0, 1], ['HShv', 10000, 2, S]] },
  keys: { name: 'Tastiere / piano', bands: [['LShv', 100, -1, S], ['PEQ', 300, -2, 1.2], ['PEQ', 3000, 1, 1], ['HShv', 10000, 1, S]] },
};
// Bande neutre (tipi e frequenze iniziali del mixer, guadagno 0).
const FLAT = {
  4: [['LShv', 80, 0, S], ['PEQ', 300, 0, 2], ['PEQ', 2000, 0, 2], ['HShv', 10000, 0, S]],
  6: [['LShv', 80, 0, S], ['PEQ', 200, 0, 2], ['PEQ', 600, 0, 2], ['PEQ', 2000, 0, 2], ['PEQ', 6000, 0, 2], ['HShv', 12000, 0, S]],
};

// --- canale completo --------------------------------------------------------------------------
const gate = (mode, thr, range, attack, hold, release) => ({ mode, thr, range, attack, hold, release });
const comp = (thr, ratio, attack, release, mgain, det = 'PEAK') => ({ thr, ratio, attack, release, mgain, knee: 2, det });
export const CHANNEL_PRESETS = [
  { group: 'Voci', items: [
    { id: 'voice', name: 'Voce', hp: 100, dyn: comp(-18, '3.0', 10, 120, 3, 'RMS') },
    { id: 'speech', name: 'Parlato (conferenza)', hp: 120, gate: gate('EXP2', -50, 10, 1, 100, 300), dyn: comp(-20, '4.0', 8, 150, 4, 'RMS') },
    { id: 'choir', name: 'Cori', hp: 150, dyn: comp(-20, '3.0', 15, 150, 2, 'RMS') },
  ] },
  { group: 'Chitarre e basso', items: [
    { id: 'acoustic', name: 'Chitarra acustica', hp: 90, dyn: comp(-20, '3.0', 20, 150, 2) },
    { id: 'electric', name: 'Chitarra elettrica', hp: 90 },
    { id: 'bass', name: 'Basso', hp: 35, dyn: comp(-20, '4.0', 20, 200, 3) },
  ] },
  { group: 'Batteria', items: [
    { id: 'kick', name: 'Cassa', hp: 35, gate: gate('GATE', -35, 40, 0.5, 50, 150), dyn: comp(-18, '4.0', 10, 100, 2) },
    { id: 'snare', name: 'Rullante', hp: 100, gate: gate('GATE', -35, 30, 0.5, 40, 120), dyn: comp(-18, '3.0', 10, 100, 2) },
    { id: 'tom', name: 'Tom', hp: 70, gate: gate('GATE', -35, 30, 0.5, 80, 250) },
    { id: 'overhead', name: 'Overhead / piatti', hp: 150 },
  ] },
  { group: 'Tastiere', items: [
    { id: 'keys', name: 'Tastiere / piano', hp: 60, dyn: comp(-20, '2.0', 20, 200, 1) },
  ] },
];

// --- scrittura dei valori ---------------------------------------------------------------------

/** Converte un valore reale (Hz, dB, ms, nome di enum) nel valore OSC del parametro. */
function oscValue(spec, real) {
  if (spec.kind === 'enum') return typeof real === 'string' ? Math.max(0, spec.options.indexOf(real)) : real;
  if (spec.kind === 'bool') return real ? 1 : 0;
  return Math.min(1, Math.max(0, toNorm(spec, real)));
}

/** Indirizzi e valori (reali) per bande EQ. */
function eqValues(strip, bands) {
  const out = [];
  bands.forEach(([type, f, g, q], i) => {
    const b = `${strip.base}/eq/${i + 1}`;
    out.push([`${b}/type`, EQ_TYPES.indexOf(type)], [`${b}/f`, f], [`${b}/g`, g], [`${b}/q`, q]);
  });
  return out;
}

/** Valori di un preset di canale (o del reset se preset è null). */
function channelValues(strip, preset, params) {
  const base = strip.base;
  const out = [];
  const defaults = prefix => [...params.keys()].filter(a => a.startsWith(prefix)).map(a => [a, null]);
  if (strip.preamp) {
    out.push([`${base}/preamp/hpon`, preset?.hp ? 1 : 0]);
    if (preset?.hp) out.push([`${base}/preamp/hpf`, preset.hp]);
  }
  if (strip.gate) {
    out.push(...defaults(`${base}/gate/`));
    if (preset?.gate) for (const [k, v] of Object.entries(preset.gate)) out.push([`${base}/gate/${k}`, v]);
    out.push([`${base}/gate/on`, preset?.gate ? 1 : 0]);
  }
  if (strip.dyn) {
    out.push(...defaults(`${base}/dyn/`));
    if (preset?.dyn) for (const [k, v] of Object.entries(preset.dyn)) out.push([`${base}/dyn/${k}`, v]);
    out.push([`${base}/dyn/on`, preset?.dyn ? 1 : 0]);
  }
  if (strip.eqBands) {
    const eq = preset && EQ_PRESETS[preset.id];
    out.push(...eqValues(strip, eq && strip.eqBands === 4 ? eq.bands : FLAT[strip.eqBands]));
    out.push([`${base}/eq/on`, eq ? 1 : 0]);
  }
  return out;
}

// --- menu a tendina con Annulla e Reset -------------------------------------------------------

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * kind 'channel': canale completo (solo canali d'ingresso); kind 'eq': solo EQ.
 * Restituisce l'elemento con menu, Annulla e Reset.
 */
export function presetMenu(scope, strip, params, kind) {
  const wrap = h('div', 'preset-menu');
  const label = h('label', 'preset-label', kind === 'channel' ? 'Preset del canale' : 'Preset EQ');
  const select = h('select', 'preset-select');
  select.add(new Option(kind === 'channel' ? 'Scegli uno strumento…' : 'Scegli una curva…', ''));
  if (kind === 'channel') {
    for (const g of CHANNEL_PRESETS) {
      const og = document.createElement('optgroup');
      og.label = g.group;
      g.items.forEach(p => og.append(new Option(p.name, p.id)));
      select.append(og);
    }
  } else if (strip.eqBands === 4) {
    for (const [id, p] of Object.entries(EQ_PRESETS)) select.add(new Option(p.name, id));
  }
  label.append(select);
  if (select.options.length === 1) label.hidden = true; // nessun preset per questa strip: resta solo Reset
  const undo = h('button', 'btn ghost', 'Annulla');
  undo.type = 'button';
  undo.hidden = true;
  const reset = h('button', 'btn ghost', 'Reset');
  reset.type = 'button';
  reset.title = kind === 'channel' ? 'Low cut, gate e compressore spenti, EQ piatto' : 'EQ piatto';
  wrap.append(label, undo, reset);

  let saved = null;
  const write = values => {
    saved = values.map(([a]) => [a, scope.get(a, params.get(a))]);
    for (const [a, real] of values) {
      const spec = params.get(a);
      if (!spec) continue;
      scope.set(a, spec, real === null ? defaultValue(spec) : oscValue(spec, real));
    }
    undo.hidden = false;
  };
  const allPresets = CHANNEL_PRESETS.flatMap(g => g.items);

  select.addEventListener('change', async () => {
    const id = select.value;
    if (!id) return;
    if (kind === 'channel') {
      const p = allPresets.find(x => x.id === id);
      const ok = await ask({
        title: `Caricare il preset "${p.name}"?`,
        message: 'Imposta low cut, gate, compressore ed EQ di questo canale come punto di partenza. Il gain e il fader non cambiano. Puoi annullare subito dopo.',
        confirmText: 'Carica',
      });
      if (!ok) { select.value = ''; return; }
      write(channelValues(strip, p, params));
      notify(`Preset "${p.name}" caricato`);
    } else {
      write([...eqValues(strip, EQ_PRESETS[id].bands), [`${strip.base}/eq/on`, 1]]);
    }
  });
  undo.addEventListener('click', () => {
    saved?.forEach(([a, v]) => params.get(a) && scope.set(a, params.get(a), v));
    saved = null;
    undo.hidden = true;
    select.value = '';
  });
  reset.addEventListener('click', async () => {
    const ok = await ask({
      title: kind === 'channel' ? 'Reset del canale?' : 'Reset dell\'EQ?',
      message: kind === 'channel'
        ? 'Low cut, gate e compressore tornano spenti con i valori iniziali, l\'EQ diventa piatto. Gain e fader non cambiano. Puoi annullare subito dopo.'
        : 'Tutte le bande tornano a 0 dB con frequenze e tipi iniziali. Puoi annullare subito dopo.',
      confirmText: 'Reset',
    });
    if (!ok) return;
    write(kind === 'channel' ? channelValues(strip, null, params) : eqValues(strip, FLAT[strip.eqBands]));
    select.value = '';
  });
  return wrap;
}

