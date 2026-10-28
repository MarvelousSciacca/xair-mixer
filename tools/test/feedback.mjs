// Prove del rilevatore di feedback con spettri simulati: note musicali (con armoniche, vibrato,
// brevi) non devono far scattare il notch automatico, un tono puro che cresce sì.
// Uso: node feedback.mjs

import { FeedbackMonitor } from '../../public/js/feedback.js';
import { buildStrips } from '../../public/js/model.js';
import { RTA_BINS } from '../../public/js/dsp.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}

const FRAME_MS = 100;
const OCT = (RTA_BINS - 1) / Math.log2(1000); // bande per ottava

class FakeMixer {
  constructor() {
    this.values = new Map();
    this.meters = new Array(100).fill(-90);
  }
  get(a, d) {
    return this.values.has(a) ? this.values.get(a) : d;
  }
  set(a, v) {
    this.values.set(a, v);
  }
}

/** Spettro di fondo: rumore musicale a ~-55 dB con piccole variazioni (sempre uguali tra le prove). */
function floor(t) {
  return Array.from({ length: RTA_BINS }, (_, i) => -55 + 3 * Math.sin(i * 1.7 + t * 0.013));
}

/** Aggiunge un picco stretto (con un po' di dispersione sulle bande vicine). */
function peak(spec, bin, level) {
  for (let j = Math.floor(bin) - 2; j <= Math.ceil(bin) + 2; j++) {
    if (j < 0 || j >= RTA_BINS) continue;
    const v = level - 14 * Math.abs(j - bin) ** 1.5;
    spec[j] = Math.max(spec[j], v);
  }
}

/** Nota con armoniche: fondamentale + 2f, 3f, 4f via via più deboli. */
function note(spec, bin, level) {
  [1, 2, 3, 4].forEach((k, n) => peak(spec, bin + Math.log2(k) * OCT, level - n * 4));
}

/** Esegue `ms` millisecondi di simulazione; `draw(spec, t)` aggiunge i picchi della scena. */
function run(name, ms, draw, { sensitivity = 'medium', setup } = {}) {
  const mixer = new FakeMixer();
  const strips = buildStrips();
  const monitor = new FeedbackMonitor(mixer, { request: () => () => {} }, strips);
  monitor.settings = { enabled: true, sensitivity, autoNotch: true, outputs: ['lr'] };
  const out = monitor.outputStrip('lr');
  const notches = [];
  monitor.onChange(e => {
    if (e.type === 'notch') notches.push({ t: now - start, freq: Math.round(e.alert.freq), gain: e.alert.notch.gain });
  });
  setup?.(monitor);
  const realNow = Date.now;
  const start = 1_000_000;
  let now = start;
  Date.now = () => now;
  try {
    for (let t = 0; t < ms; t += FRAME_MS) {
      now = start + t;
      const spec = floor(t);
      draw(spec, t);
      monitor._frame(out, spec);
    }
  } finally {
    Date.now = realNow;
  }
  return { monitor, notches, alerts: monitor.alerts, name };
}

// 1. Voce che tiene una nota per 4 secondi (con armoniche): niente notch, niente avviso.
{
  const r = run('nota tenuta', 4000, spec => note(spec, 45, -18));
  check('nota tenuta con armoniche: nessun notch automatico', r.notches.length === 0, JSON.stringify(r.notches));
  check('nota tenuta con armoniche: nessun avviso', r.alerts.length === 0, JSON.stringify(r.alerts.map(a => a.freq)));
}

// 2. Accordo (tre note con armoniche) tenuto 4 secondi.
{
  const r = run('accordo', 4000, spec => [40, 44, 47].forEach(b => note(spec, b, -20)));
  check('accordo tenuto: nessun notch automatico', r.notches.length === 0, JSON.stringify(r.notches));
}

// 3. Nota con vibrato (la frequenza oscilla di ±1 banda a 5,5 Hz), senza armoniche evidenti.
//    (non 5 Hz esatti: letto 10 volte al secondo sembrerebbe fermo)
{
  const r = run('vibrato', 4000, (spec, t) => peak(spec, 50 + Math.sin((t / 1000) * 2 * Math.PI * 5.5) * 1.2, -18));
  check('tono con vibrato: nessun notch automatico', r.notches.length === 0, JSON.stringify(r.notches));
}

// 4. Tono puro breve (0,8 s), per esempio una nota di synth: al più un avviso, nessun notch.
{
  const r = run('tono breve', 3000, (spec, t) => t < 800 && peak(spec, 55, -15));
  check('tono puro di 0,8 s: nessun notch automatico', r.notches.length === 0, JSON.stringify(r.notches));
}

// 5. Feedback vero: tono puro fermo che cresce di 0,3 dB ogni lettura, sopra la musica.
{
  const r = run('feedback', 4000, (spec, t) => {
    note(spec, 30, -25); // la musica continua sotto
    peak(spec, 62, Math.min(-6, -22 + (t / FRAME_MS) * 0.3));
  });
  const first = r.notches[0];
  check('feedback che cresce: avviso', r.alerts.length >= 1);
  check('feedback che cresce: notch automatico', !!first, 'nessun notch');
  if (first) {
    check('feedback: notch alla frequenza giusta (±1/6 di ottava)', Math.abs(Math.log2(first.freq / (20 * 1000 ** (62 / 99)))) < 1 / 6, `${first.freq} Hz`);
    check('feedback: notch entro 2,5 s', first.t <= 2500, `${first.t} ms`);
    check('feedback: notch iniziale a -6 dB', first.gain === -6, `${first.gain} dB`);
  }
}

// 6. Il notch funziona (il picco scende): non va approfondito.
{
  let notchedAt = null;
  const r = run('feedback risolto', 6000, (spec, t) => {
    const level = notchedAt === null ? -10 : Math.max(-40, -10 - ((t - notchedAt) / FRAME_MS) * 2);
    peak(spec, 62, level);
  }, { setup: m => m.onChange(e => { if (e.type === 'notch' && notchedAt === null) notchedAt = Date.now() - 1_000_000; }) });
  check('feedback risolto dal notch: un solo notch, non approfondito', r.notches.length === 1, JSON.stringify(r.notches));
}

// 7. Il feedback resta dopo il notch: viene approfondito, fino a -15 dB al massimo.
{
  const r = run('feedback ostinato', 12000, spec => peak(spec, 62, -10));
  const gains = r.notches.map(n => n.gain);
  check('feedback ostinato: notch approfondito', gains.length >= 2 && gains.at(-1) < gains[0], JSON.stringify(gains));
  check('feedback ostinato: mai oltre -15 dB', gains.every(g => g >= -15), JSON.stringify(gains));
}

// 8. Tanti toni puri insieme (per esempio un pad di synth): pochi notch e mai tanti di colpo.
{
  const bins = [35, 41, 52, 58, 66, 71, 77, 83];
  const r = run('tanti toni', 15000, spec => bins.forEach(b => peak(spec, b, -12)));
  const times = r.notches.filter((n, i, a) => a.findIndex(x => x.freq === n.freq) === i).map(n => n.t);
  check('tanti toni: al massimo 4 notch automatici per uscita', times.length <= 4, `${times.length}`);
  check('tanti toni: almeno 2,5 s tra due notch nuovi', times.every((t, i) => i === 0 || t - times[i - 1] >= 2500), JSON.stringify(times));
}

// 8b. Nota che cresce di volume (crescendo): crescono anche le armoniche, quindi resta musica.
{
  const r = run('crescendo', 4000, (spec, t) => note(spec, 45, Math.min(-6, -24 + (t / FRAME_MS) * 0.4)));
  check('nota in crescendo con armoniche: nessun notch automatico', r.notches.length === 0, JSON.stringify(r.notches));
}

// 9. Su tutta l'estensione: una nota tenuta non deve mai dare notch; il feedback sopra la musica
//    deve essere preso quasi sempre (può sfuggire solo se cade esattamente su un'armonica della musica).
{
  const falsi = [];
  for (let b = 15; b <= 75; b++) {
    const r = run('nota', 4000, spec => note(spec, b, -18));
    if (r.notches.length) falsi.push(b);
  }
  check('note tenute da 50 Hz a 2,6 kHz: nessun notch automatico', falsi.length === 0, `bande: ${falsi.join(', ')}`);

  const persi = [];
  for (let b = 20; b <= 92; b++) {
    const r = run('feedback', 4000, (spec, t) => {
      note(spec, 28, -24);
      note(spec, 37, -26);
      peak(spec, b, Math.min(-6, -22 + (t / FRAME_MS) * 0.3));
    });
    if (!r.notches.length) persi.push(b);
  }
  const preso = 1 - persi.length / 73;
  check(`feedback sopra la musica preso nel ${Math.round(preso * 100)}% delle frequenze (minimo 95%)`, preso >= 0.95, `persi: ${persi.join(', ')}`);
}

console.log(failures ? `\n${failures} prove fallite` : '\ntutte le prove del rilevatore di feedback passate');
process.exit(failures ? 1 : 0);
