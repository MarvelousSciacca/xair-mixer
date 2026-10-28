// Rilevatore di feedback sulle uscite (Main LR e bus).
//
// 1. Ogni 100 ms legge i livelli in dB delle uscite (/meters/1): un'uscita che sale in fretta o
//    resta vicina al clip diventa "sospetta" e l'RTA la analizza più spesso.
// 2. Nello spettro dell'uscita cerca picchi stretti molto più alti delle bande vicine.
// 3. Scarta i picchi "musicali": una nota ha armoniche (2f, 3f) o è a sua volta un'armonica di una
//    nota più grave, il feedback è un tono quasi puro.
// 4. Un picco diventa feedback se resta alla stessa frequenza per più letture e non sta calando
//    (una nota musicale di solito decade, il feedback resta o cresce): allora avvisa.
// 5. Il notch automatico è più prudente dell'avviso: il picco deve durare di più, restare fermo in
//    frequenza (niente vibrato), dominare lo spettro; poche bande per uscita e mai tante insieme.

import { SPEC, toNorm, fromNorm, paramMap, defaultValue, EQ_TYPES } from './params.js';
import { RTA_BINS, binFreq } from './dsp.js';
import { rtaSource } from './model.js';

export const SENSITIVITY = {
  low: { label: 'Bassa', prominence: 18, minDb: -30, hits: 7, minMs: 500, autoMs: 3000 },
  medium: { label: 'Media', prominence: 14, minDb: -40, hits: 5, minMs: 350, autoMs: 2000 },
  high: { label: 'Alta', prominence: 10, minDb: -50, hits: 4, minMs: 250, autoMs: 1200 },
};

const LEVEL_MS = 100;
const LEVEL_HISTORY = 10; // 1 secondo
const MAX_GAP_MS = 3000; // oltre questo intervallo senza vederlo, un picco viene dimenticato
const ALERT_TTL_MS = 60_000;
const NOTCH_START_DB = -6;
const NOTCH_STEP_DB = -3;
const NOTCH_MAX_DB = -15;
const NOTCH_Q = 8;
const AUTO_REPEAT_MS = 1500;
const AUTO_MAX_NOTCHES = 4; // notch automatici per uscita: oltre, solo avvisi
const AUTO_GAP_MS = 2500; // tra due notch automatici nuovi sulla stessa uscita
const AUTO_DOMINANT_DB = 6; // il picco deve stare a meno di 6 dB dal massimo dello spettro
const AUTO_DRIFT_BINS = 0.6; // escursione massima in frequenza (una banda RTA = 1/10 di ottava)
const ALERT_DRIFT_BINS = 1.2;
const HARMONIC_DB = 8; // prominenza minima perché un'armonica conti
const HARMONIC_TOL = 0.5; // in bande: quanto può scostarsi un'armonica dalla posizione attesa
const BINS_PER_OCTAVE = (RTA_BINS - 1) / Math.log2(1000);

const drift = t => Math.max(...t.bins) - Math.min(...t.bins);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const octaves = (a, b) => Math.abs(Math.log2(a / b));

/**
 * Il picco più vicino alla banda (frazionaria) `bin`: posizione interpolata, livello e prominenza
 * rispetto alle bande intorno. null se lì non c'è un massimo locale.
 */
function peakNear(spec, bin) {
  const c = Math.round(bin);
  if (c < 1 || c >= RTA_BINS - 1) return null;
  let i = c;
  for (const j of [c - 1, c + 1]) if (j > 0 && j < RTA_BINS - 1 && spec[j] > spec[i]) i = j;
  if (spec[i] < spec[i - 1] || spec[i] < spec[i + 1]) return null;
  const a = spec[i - 1], v = spec[i], b = spec[i + 1], den = a - 2 * v + b;
  const pos = i + (den ? clamp((0.5 * (a - b)) / den, -0.5, 0.5) : 0);
  const around = [];
  for (let j = i - 8; j <= i + 8; j++) if (j >= 0 && j < RTA_BINS && Math.abs(j - i) > 2) around.push(spec[j]);
  around.sort((x, y) => x - y);
  return { pos, level: v, prominence: v - around[around.length >> 1] };
}

/**
 * Se il picco in `bin` sembra una nota restituisce la banda del picco "parente": una sua armonica
 * (2f o 3f), oppure la nota più grave di cui è l'armonica (almeno altrettanto forte, meno 10 dB).
 * Altrimenti null. Le posizioni devono coincidere entro mezza banda: con musica densa, una
 * tolleranza più larga troverebbe "armoniche" per quasi ogni frequenza.
 */
export function harmonicPartner(spec, bin, level) {
  for (const k of [2, 3]) {
    const d = Math.log2(k) * BINS_PER_OCTAVE;
    const up = peakNear(spec, bin + d);
    if (up && Math.abs(up.pos - (bin + d)) <= HARMONIC_TOL && up.prominence >= HARMONIC_DB && up.level >= level - 30) return up.pos;
    const down = peakNear(spec, bin - d);
    if (down && Math.abs(down.pos - (bin - d)) <= HARMONIC_TOL && down.prominence >= HARMONIC_DB && down.level >= level - 10) return down.pos;
  }
  return null;
}

const levelAt = (spec, bin) => {
  const c = Math.round(bin);
  return Math.max(spec[c - 1] ?? -Infinity, spec[c], spec[c + 1] ?? -Infinity);
};

/**
 * Il picco va trattato come una nota? Sì se quasi sempre ha avuto un "parente" armonico, a meno che
 * cresca da solo: in una nota che sale di volume crescono anche le armoniche, mentre il feedback che
 * cade per caso su un'armonica della musica sale e la musica intorno no.
 */
function musical(t) {
  const P = t.partners.filter(Boolean);
  if (P.length * 2 < t.partners.length) return false;
  const ownRise = P.at(-1).own - P[0].own;
  const otherRise = P.at(-1).other - P[0].other;
  return !(P.length >= 10 && ownRise >= 4 && otherRise < 1.5);
}

export class FeedbackMonitor {
  constructor(mixer, rta, strips) {
    this.mixer = mixer;
    this.rta = rta;
    this.outputs = strips.filter(s => s.group === 'main' || (s.group === 'bus' && s.eqBands));
    this.settings = { enabled: false, sensitivity: 'medium', autoNotch: false, outputs: this.outputs.map(o => o.id) };
    this.tracks = new Map(); // id uscita -> picchi in osservazione
    this.levels = new Map(); // id uscita -> storico livelli
    this.alerts = [];
    this.listeners = new Set();
    this.releases = [];
    this.seq = 0;
    this.lastAuto = new Map(); // id uscita -> ora dell'ultimo notch automatico nuovo
  }

  // --- configurazione ------------------------------------------------------------------

  configure(patch) {
    Object.assign(this.settings, patch);
    this._restart();
    this._emit();
  }

  get running() {
    return this.releases.length > 0;
  }

  _restart() {
    this.releases.forEach(off => off());
    this.releases = [];
    clearInterval(this.levelTimer);
    this.tracks.clear();
    if (!this.settings.enabled) return;
    for (const o of this.outputs) {
      if (!this.settings.outputs.includes(o.id)) continue;
      this.releases.push(this.rta.request(rtaSource(o), spec => this._frame(o, spec), () => this._weight(o)));
    }
    this.levelTimer = setInterval(() => this._sampleLevels(), LEVEL_MS);
  }

  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _emit(event = { type: 'change' }) {
    this.listeners.forEach(cb => cb(event));
  }

  // --- livelli delle uscite ---------------------------------------------------------------

  outputLevel(o) {
    return Math.max(...o.meters.map(i => this.mixer.meters[i]));
  }

  _sampleLevels() {
    for (const o of this.outputs) {
      const hist = this.levels.get(o.id) ?? [];
      hist.push(this.outputLevel(o));
      if (hist.length > LEVEL_HISTORY) hist.shift();
      this.levels.set(o.id, hist);
    }
  }

  /** Priorità RTA di un'uscita: alta se il livello sale in fretta o è vicino al clip. */
  _weight(o) {
    const hist = this.levels.get(o.id);
    if (!hist?.length) return 1;
    const now = hist.at(-1);
    const cfg = SENSITIVITY[this.settings.sensitivity];
    if (now < cfg.minDb) return 0.3;
    let w = 1;
    // Il feedback sale in modo costante; la musica va su e giù. Sospetto se in 1 s il livello
    // è salito di oltre 6 dB e in almeno 7 letture su 9 è cresciuto rispetto alla precedente.
    let rises = 0;
    for (let i = 1; i < hist.length; i++) if (hist[i] > hist[i - 1] + 0.2) rises++;
    if (hist.length === LEVEL_HISTORY && now - hist[0] > 6 && rises >= 7 && now > -25) w = 6;
    if (now > -6) w = Math.max(w, 4);
    if (this.alertsFor(o.id).some(a => Date.now() - a.last < 5000)) w = Math.max(w, 5);
    return w;
  }

  // --- analisi dello spettro -----------------------------------------------------------------

  _frame(o, spec) {
    const cfg = SENSITIVITY[this.settings.sensitivity];
    const now = Date.now();
    const candidates = [];
    const top = Math.max(...spec);
    for (let i = 2; i < RTA_BINS - 2; i++) {
      const v = spec[i];
      if (v < cfg.minDb || v < spec[i - 1] || v < spec[i + 1]) continue;
      const around = [];
      for (let j = i - 8; j <= i + 8; j++) if (j >= 0 && j < RTA_BINS && Math.abs(j - i) > 2) around.push(spec[j]);
      around.sort((a, b) => a - b);
      const prominence = v - around[around.length >> 1];
      if (prominence < cfg.prominence) continue;
      // interpolazione parabolica per stimare la frequenza tra due bande
      const a = spec[i - 1], c = spec[i + 1], den = a - 2 * v + c;
      const offset = den ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
      const partner = harmonicPartner(spec, i + offset, v);
      candidates.push({ bin: i + offset, level: v, prominence, partner: partner === null ? null : { own: v, other: levelAt(spec, partner) } });
    }

    let tracks = (this.tracks.get(o.id) ?? []).filter(t => now - t.last < MAX_GAP_MS);
    for (const c of candidates) {
      let t = tracks.find(t => Math.abs(t.bin - c.bin) <= 1.5);
      if (!t) tracks.push((t = { bin: c.bin, hits: 0, misses: 0, first: now, levels: [], bins: [], partners: [] }));
      t.bin = t.hits ? t.bin * 0.7 + c.bin * 0.3 : c.bin;
      t.hits++;
      t.misses = 0;
      t.last = now;
      t.matched = true;
      t.levels.push(c.level);
      if (t.levels.length > 12) t.levels.shift();
      t.bins.push(c.bin);
      if (t.bins.length > 12) t.bins.shift();
      t.partners.push(c.partner);
      if (t.partners.length > 24) t.partners.shift(); // 2,4 s: anche un feedback lento sale di qualche dB
      t.dominant = c.level >= top - AUTO_DOMINANT_DB;
    }
    for (const t of tracks) {
      if (!t.matched) t.misses++;
      t.matched = false;
    }
    tracks = tracks.filter(t => t.misses <= 4);
    this.tracks.set(o.id, tracks);

    for (const t of tracks) {
      if (t.misses || musical(t)) continue;
      if (!t.alert) {
        if (t.hits < cfg.hits || now - t.first < cfg.minMs) continue;
        const L = t.levels;
        const slope = (L.at(-1) - L[0]) / Math.max(1, L.length - 1);
        if (slope < -0.7) continue; // sta calando: probabilmente una nota musicale
        if (drift(t) > ALERT_DRIFT_BINS) continue; // la frequenza si muove: voce o strumento
        t.alert = this._raise(o, t);
      } else {
        this._refresh(t.alert, t);
      }
      if (this.settings.autoNotch && this._confirmed(t, cfg, now)) this._autoNotch(t.alert, t);
    }
  }

  _raise(o, t) {
    const now = Date.now();
    const freq = binFreq(t.bin);
    let alert = this.alerts.find(a => a.output === o.id && octaves(a.freq, freq) < 1 / 6);
    if (alert) {
      alert.count++;
      alert.dismissed = false;
    } else {
      alert = { id: ++this.seq, output: o.id, freq, first: now, count: 1, notch: null, dismissed: false };
      this.alerts.unshift(alert);
      this.alerts.length = Math.min(this.alerts.length, 50);
    }
    alert.last = now;
    alert.level = t.levels.at(-1);
    this._emit({ type: 'alert', alert });
    return alert;
  }

  _refresh(alert, t) {
    const now = Date.now();
    alert.level = t.levels.at(-1);
    alert.last = now;
    if (now - (alert.emitted ?? 0) > 500) {
      alert.emitted = now;
      this._emit();
    }
  }

  /** Abbastanza certo per agire da solo: dura, è fermo in frequenza, non cala e domina lo spettro. */
  _confirmed(t, cfg, now) {
    if (!t.alert || now - t.first < cfg.autoMs || !t.dominant) return false;
    if (drift(t) > AUTO_DRIFT_BINS) return false;
    const L = t.levels;
    return (L.at(-1) - L[0]) / Math.max(1, L.length - 1) >= -0.2;
  }

  _autoNotch(alert, t) {
    const now = Date.now();
    if (alert.notch) {
      // Approfondisce solo se dopo il notch il picco non è sceso di almeno 3 dB.
      if (now - alert.notch.time < AUTO_REPEAT_MS || alert.notch.gain <= NOTCH_MAX_DB) return;
      if (t.levels.at(-1) < alert.notch.level - 3) return;
    } else {
      const auto = this.alerts.filter(a => a.output === alert.output && a.notch?.auto).length;
      if (auto >= AUTO_MAX_NOTCHES || now - (this.lastAuto.get(alert.output) ?? 0) < AUTO_GAP_MS) return;
      this.lastAuto.set(alert.output, now);
    }
    try {
      this.applyNotch(alert);
      alert.notch.auto = true;
      alert.notch.level = t.levels.at(-1);
    } catch {
      /* nessuna banda libera: resta l'avviso */
    }
  }

  // --- avvisi -----------------------------------------------------------------------------

  outputStrip(id) {
    return this.outputs.find(o => o.id === id);
  }

  alertsFor(outputId) {
    const now = Date.now();
    return this.alerts.filter(a => a.output === outputId && !a.dismissed && now - a.last < ALERT_TTL_MS);
  }

  activeAlerts() {
    const now = Date.now();
    return this.alerts.filter(a => !a.dismissed && now - a.last < ALERT_TTL_MS);
  }

  dismiss(alert) {
    alert.dismissed = true;
    this._emit();
  }

  clear() {
    this.alerts = [];
    this.tracks.clear();
    this.lastAuto.clear();
    this._emit();
  }

  // --- notch -------------------------------------------------------------------------------

  /**
   * Mette (o approfondisce) un notch stretto sull'EQ dell'uscita alla frequenza del feedback.
   * Usa una banda già impostata come notch vicino a quella frequenza, altrimenti una banda libera
   * (PEQ a 0 dB), preferendo quelle centrali. Restituisce { band, gain }.
   */
  applyNotch(alert) {
    const strip = this.outputStrip(alert.output);
    const params = paramMap(strip);
    const base = strip.base;
    const raw = a => this.mixer.get(a, defaultValue(params.get(a)));
    const real = a => fromNorm(params.get(a), raw(a));
    const band = i => `${base}/eq/${i + 1}`;
    const isPeq = i => ['PEQ', 'VEQ'].includes(EQ_TYPES[raw(`${band(i)}/type`)]);

    const order = [...Array(strip.eqBands).keys()].sort((a, b) =>
      Math.abs(a - (strip.eqBands - 1) / 2) - Math.abs(b - (strip.eqBands - 1) / 2));

    let index = order.find(i => isPeq(i) && real(`${band(i)}/q`) >= 5 && real(`${band(i)}/g`) <= -3
      && octaves(real(`${band(i)}/f`), alert.freq) < 1 / 6);
    let gain;
    if (index !== undefined) {
      gain = Math.max(NOTCH_MAX_DB, real(`${band(index)}/g`) + NOTCH_STEP_DB);
    } else {
      index = order.find(i => isPeq(i) && Math.abs(real(`${band(i)}/g`)) < 0.5);
      if (index === undefined) throw new Error(`Nessuna banda EQ libera su ${strip.label}`);
      gain = NOTCH_START_DB;
      const b = band(index);
      this.mixer.set(`${b}/type`, EQ_TYPES.indexOf('PEQ'), 'i');
      this.mixer.set(`${b}/f`, toNorm(params.get(`${b}/f`), clamp(alert.freq, 20, 20000)));
      this.mixer.set(`${b}/q`, toNorm(SPEC.eqQ, NOTCH_Q));
    }
    this.mixer.set(`${band(index)}/g`, toNorm(SPEC.eqG, gain));
    this.mixer.set(`${base}/eq/on`, 1, 'i');
    alert.notch = { band: index + 1, gain, time: Date.now() };
    this._emit({ type: 'notch', alert });
    return alert.notch;
  }
}
