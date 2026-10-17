// Gestore dell'RTA del mixer. Il mixer analizza una sola sorgente alla volta: quando più parti
// dell'app chiedono sorgenti diverse (grafico EQ aperto, monitor feedback sulle uscite), il gestore
// le alterna, dando più tempo a quelle con peso maggiore.

import { RTA_METERS, RTA_SOURCE } from './model.js';

const TICK_MS = 50;
const DWELL_MS = 200; // tempo minimo su una sorgente prima di cambiare...
const MAX_DWELL_MS = 800; // ...allungato fino a qui per le sorgenti con peso maggiore
const SETTLE_MS = 80; // dopo un cambio, i primi pacchetti possono riferirsi ancora alla sorgente precedente
// L'RTA del mixer ha una "coda": cambiando sorgente lo spettro precedente scende di ~20 dB/s invece di
// sparire (verificato su XR18V2). Dopo un cambio si scartano i pacchetti finché lo spettro sta solo
// calando, al massimo per MAX_SETTLE_MS.
const MAX_SETTLE_MS = 1200;
const FOCUS_BREAK_WEIGHT = 5; // peso oltre il quale una sorgente "urgente" interrompe il grafico in primo piano

/** true se il pacchetto è solo la coda in discesa del precedente (nessuna banda sale). */
function isDecayTail(values, previous) {
  if (!previous) return true;
  let fell = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > previous[i] + 0.5) return false;
    if (values[i] < previous[i] - 0.1) fell++;
  }
  return fell > 0;
}

export class Rta {
  constructor(mixer) {
    this.mixer = mixer;
    this.requests = new Set();
    this.current = null;
    this.switchedAt = 0;
    this.lastFrame = new Map(); // sorgente -> ultimo pacchetto ricevuto
    this.releaseMeters = null;
    mixer.onMeters(RTA_METERS, values => this._frame(values));
    // Dopo una (ri)connessione il mixer va riportato sulla sorgente corrente.
    let previous = null;
    mixer.onStatus(status => {
      if (status === 'online' && previous !== 'online' && this.current !== null) this._switch(this.current);
      previous = status;
    });
  }

  /**
   * Chiede lo spettro di una sorgente (indice RTA). cb(Float32Array di 100 bande in dB).
   * weight() > 1 la fa analizzare più spesso. focus: true (grafico aperto davanti all'utente) tiene
   * l'RTA su quella sorgente; le altre vengono visitate solo se urgenti (peso >= FOCUS_BREAK_WEIGHT).
   * Restituisce la funzione di rilascio.
   */
  request(source, cb, weight = () => 1, { focus = false } = {}) {
    const req = { source, cb, weight, focus };
    this.requests.add(req);
    this._update();
    return () => {
      if (this.requests.delete(req)) this._update();
    };
  }

  get sources() {
    const all = [...new Set([...this.requests].map(r => r.source))];
    const focused = [...this.requests].filter(r => r.focus).map(r => r.source);
    if (!focused.length) return all;
    return all.filter(s => focused.includes(s) || this._weight(s) >= FOCUS_BREAK_WEIGHT);
  }

  _update() {
    if (!this.requests.size) {
      clearInterval(this.timer);
      this.timer = null;
      this.releaseMeters?.();
      this.releaseMeters = null;
      this.current = null;
      return;
    }
    this.releaseMeters ??= this.mixer.subscribeMeters(RTA_METERS);
    this.timer ??= setInterval(() => this._schedule(), TICK_MS);
    if (!this.sources.includes(this.current)) this._switch(this._pick());
  }

  _weight(source) {
    return Math.max(...[...this.requests].filter(r => r.source === source).map(r => r.weight()));
  }

  _pick() {
    const now = Date.now();
    let best = null;
    let bestScore = -Infinity;
    for (const source of this.sources) {
      const weight = this._weight(source);
      const score = (now - (this.lastFrame.get(source) ?? 0)) * weight;
      if (score > bestScore) {
        bestScore = score;
        best = source;
      }
    }
    return best;
  }

  _schedule() {
    const now = Date.now();
    if (!this.settledAt && now - this.switchedAt < MAX_SETTLE_MS) return; // la coda non è ancora finita
    const dwell = Math.min(MAX_DWELL_MS, DWELL_MS * Math.max(1, this._weight(this.current)));
    if (now - (this.settledAt ?? this.switchedAt) < dwell) return;
    const next = this._pick();
    if (next !== this.current) this._switch(next);
  }

  _switch(source) {
    this.current = source;
    this.switchedAt = Date.now();
    this.settledAt = null;
    this.previous = null;
    this.mixer.set(RTA_SOURCE, source, 'i');
  }

  _frame(values) {
    if (this.current === null) return;
    const now = Date.now();
    if (!this.settledAt) {
      const previous = this.previous;
      this.previous = values;
      const waited = now - this.switchedAt;
      if (waited < SETTLE_MS || (waited < MAX_SETTLE_MS && isDecayTail(values, previous))) return;
      this.settledAt = now;
    }
    this.lastFrame.set(this.current, now);
    for (const r of this.requests) if (r.source === this.current) r.cb(values);
  }
}
