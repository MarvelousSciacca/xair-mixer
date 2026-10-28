// Stato del mixer e protocollo X Air, indipendente dal trasporto usato.

import { MULTI_VALUE } from './model.js';

const KEEPALIVE_MS = 8000; // /xremote e /meters scadono dopo 10 s
const TIMEOUT_MS = 3000;
const SEND_INTERVAL_MS = 15;
// Richieste di lettura: a gruppi, con un ritmo che il Wi-Fi del mixer regge. Quelle senza risposta
// (pacchetti UDP persi) vengono ripetute finché ogni giro porta nuove risposte, al massimo QUERY_RETRIES volte.
const QUERY_BATCH = 12;
const QUERY_GAP_MS = 15;
const QUERY_RETRY_MS = 1000;
const QUERY_RETRIES = 8;
// Annulla/Ripeti: modifiche fatte di seguito sullo stesso parametro (un fader trascinato) diventano
// un solo passo, come tutte quelle fatte nello stesso istante (un preset).
const HISTORY_MAX = 100;
const HISTORY_MERGE_MS = 1500;

export const ZERO_DB = 0.75;

// Legge del fader X32/X Air: valore 0..1 <-> dB (-∞ .. +10).
export function faderToDb(f) {
  if (f <= 0) return -Infinity;
  if (f >= 0.5) return f * 40 - 30;
  if (f >= 0.25) return f * 80 - 50;
  if (f >= 0.0625) return f * 160 - 70;
  return f * 480 - 90;
}

export function dbToFader(db) {
  if (db <= -90) return 0;
  if (db >= -10) return Math.min(1, (db + 30) / 40);
  if (db >= -30) return (db + 50) / 80;
  if (db >= -60) return (db + 70) / 160;
  return (db + 90) / 480;
}

export function formatDb(db) {
  if (!Number.isFinite(db)) return '-∞';
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}`;
}

function blobBytes(value) {
  if (value instanceof Uint8Array) return value;
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

/** Blob dei meter X Air: int32 iniziale, poi valori int16 little-endian in 1/256 dB. */
function decodeMeters(value) {
  if (!value) return null;
  const bytes = blobBytes(value);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array((bytes.length - 4) >> 1);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(4 + i * 2, true) / 256;
  return out;
}

export class Mixer {
  constructor(transport) {
    this.t = transport;
    this.values = new Map();
    this.types = new Map(); // tipo OSC ('f', 'i', 's') dell'ultimo valore ricevuto dal mixer
    this.listeners = new Map();
    this.statusListeners = new Set();
    this.meters = new Float32Array(64).fill(-128);
    this.status = 'disconnected'; // disconnected | connecting | online | lost
    this.info = null;
    this.ip = null;
    this.addresses = [];
    this.pending = new Map();
    this.queryQueue = [];
    this.lastRx = 0;
    this.lastPing = 0;
    this.meterSubs = new Map([['/meters/1', 1]]); // percorso -> numero di richieste attive
    this.meterListeners = new Map();
    this.setHooks = [];
    this.held = new Map(); // indirizzi che l'utente sta muovendo -> quante prese attive
    this.undoStack = [];
    this.redoStack = [];
    this.historyListeners = new Set();
    transport.onMessage = m => this._receive(m);
  }

  // --- parametri -------------------------------------------------------------

  on(address, cb) {
    let set = this.listeners.get(address);
    if (!set) this.listeners.set(address, (set = new Set()));
    set.add(cb);
    if (this.values.has(address)) cb(this.values.get(address));
    return () => set.delete(cb);
  }

  get(address, fallback) {
    return this.values.has(address) ? this.values.get(address) : fallback;
  }

  /** Imposta un parametro: aggiorna subito l'interfaccia e invia al mixer (raggruppando i movimenti rapidi). */
  set(address, value, type = 'f', seen = new Set()) {
    if (seen.has(address)) return;
    if (!seen.size) {
      this._record(address, value, type);
      if (!address.startsWith('/-')) this.userSetListeners?.forEach(cb => cb(address, value, type));
    }
    seen.add(address);
    this._store(address, value);
    this.pending.set(address, { type, value });
    this.flushTimer ??= setTimeout(() => this._flush(), SEND_INTERVAL_MS);
    // Parametri collegati (es. canali in link stereo) da impostare insieme a questo.
    for (const hook of this.setHooks) {
      for (const extra of hook(address, value, type) ?? []) this.set(extra.address, extra.value, extra.type ?? type, seen);
    }
  }

  /** cb(address, value, type) per ogni modifica fatta dall'utente (non i collegamenti stereo). */
  onUserSet(cb) {
    (this.userSetListeners ??= new Set()).add(cb);
    return () => this.userSetListeners.delete(cb);
  }

  // --- annulla / ripeti --------------------------------------------------------

  /** cb({ canUndo, canRedo }) quando cambia la cronologia. */
  onHistory(cb) {
    this.historyListeners.add(cb);
    cb(this._historyState());
    return () => this.historyListeners.delete(cb);
  }

  undo() {
    return this._step(this.undoStack, this.redoStack, 'before');
  }

  redo() {
    return this._step(this.redoStack, this.undoStack, 'after');
  }

  clearHistory() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.openStep = null;
    this._historyChanged();
  }

  _historyState() {
    return { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
  }

  _historyChanged() {
    const state = this._historyState();
    this.historyListeners.forEach(cb => cb(state));
  }

  /** Registra una modifica dell'utente (non quelle di stato interno come la sorgente RTA, '/-...'). */
  _record(address, value, type) {
    if (this.replaying || address.startsWith('/-')) return;
    const before = this.values.get(address);
    if (before === undefined || before === value) return;
    const now = Date.now();
    const last = this.undoStack.at(-1);
    const sameGesture = last && last === this.openStep && last.changes.has(address)
      && (this.held.has(address) || now - last.at < HISTORY_MERGE_MS);
    let step = last && (last === this.tickStep || sameGesture) ? last : null;
    const created = !step;
    if (created) {
      step = { changes: new Map(), at: now };
      this.undoStack.push(step);
      if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
      this.tickStep = step;
      queueMicrotask(() => { if (this.tickStep === step) this.tickStep = null; });
    }
    const change = step.changes.get(address);
    if (change) change.after = value;
    else step.changes.set(address, { before, after: value, type });
    step.at = now;
    this.openStep = step;
    if (created || this.redoStack.length) {
      this.redoStack.length = 0;
      this._historyChanged();
    }
  }

  _step(from, to, key) {
    const step = from.pop();
    if (!step) return false;
    this.openStep = null;
    this.tickStep = null;
    this.replaying = true;
    try {
      const changes = [...step.changes];
      if (key === 'before') changes.reverse();
      for (const [address, c] of changes) this.set(address, c[key], c.type);
    } finally {
      this.replaying = false;
    }
    to.push(step);
    this._historyChanged();
    return true;
  }

  /** Mentre un controllo è tenuto, i valori ricevuti dal mixer per quell'indirizzo vengono ignorati. */
  hold(address) {
    this.held.set(address, (this.held.get(address) ?? 0) + 1);
  }

  /** Rilascia il controllo; poco dopo si rilegge il valore per essere certi di essere allineati. */
  release(address) {
    const n = (this.held.get(address) ?? 1) - 1;
    if (n > 0) this.held.set(address, n);
    else this.held.delete(address);
    if (!n && this.ip) setTimeout(() => !this.held.has(address) && this.t.send(address, []), 300);
  }

  /**
   * Imposta molti parametri (es. caricando una scena da file) a un ritmo che il Wi-Fi regge,
   * poi li rilegge per verificarli. onProgress(fatti, totali). Non applica i collegamenti stereo.
   */
  async setMany(entries, onProgress = () => {}) {
    this.clearHistory(); // dopo una scena caricata, Annulla non riporta indietro solo pezzi di quella prima
    for (let i = 0; i < entries.length; i += QUERY_BATCH) {
      for (const { address, value, type } of entries.slice(i, i + QUERY_BATCH)) {
        this._store(address, value);
        this.t.send(address, [{ type, value }]);
      }
      onProgress(Math.min(entries.length, i + QUERY_BATCH), entries.length);
      await new Promise(r => setTimeout(r, QUERY_GAP_MS * 2));
    }
    this.query(entries.map(e => e.address));
  }

  /** Invia un comando (es. caricare uno snapshot) senza memorizzarlo come parametro. */
  command(address, args = []) {
    this.t.send(address, args);
  }

  /** hook(address, value, type) -> [{ address, value, type? }] da impostare insieme. */
  addSetHook(hook) {
    this.setHooks.push(hook);
  }

  /** Legge parametri dal mixer. priority: true li mette in testa alla coda (es. pannello appena aperto). */
  query(addresses, { priority = false } = {}) {
    this.awaiting ??= new Set();
    addresses.forEach(a => this.awaiting.add(a));
    this.retryRound = 0;
    this.lastMissing = Infinity;
    this.stalls = 0;
    this._enqueue(addresses, priority);
  }

  _enqueue(addresses, priority = false) {
    clearTimeout(this.retryTimer);
    const queued = new Set(this.queryQueue);
    const fresh = [...new Set(addresses)].filter(a => !queued.has(a));
    if (priority) this.queryQueue.unshift(...fresh);
    else this.queryQueue.push(...fresh);
    if (!this.queryTimer) this._drainQueries();
  }

  _retryMissing() {
    if (!this.awaiting?.size || !this.ip) return;
    const missing = this.awaiting.size;
    this.stalls = missing < this.lastMissing ? 0 : this.stalls + 1;
    this.lastMissing = missing;
    if (++this.retryRound > QUERY_RETRIES || this.stalls >= 3) {
      // Indirizzi che il mixer non riconosce: si smette di chiederli.
      this.unanswered = [...this.awaiting];
      if (this.unanswered.length) console.warn('Parametri senza risposta dal mixer:', this.unanswered);
      this.awaiting.clear();
      return;
    }
    this._enqueue([...this.awaiting]);
  }

  _flush() {
    this.flushTimer = null;
    for (const [address, arg] of this.pending) this.t.send(address, [arg]);
    this.pending.clear();
  }

  _drainQueries() {
    for (const address of this.queryQueue.splice(0, QUERY_BATCH)) this.t.send(address, []);
    if (this.queryQueue.length) {
      this.queryTimer = setTimeout(() => this._drainQueries(), QUERY_GAP_MS);
    } else {
      this.queryTimer = null;
      this.retryTimer = setTimeout(() => this._retryMissing(), QUERY_RETRY_MS);
    }
  }

  _store(address, value) {
    this.values.set(address, value);
    this.listeners.get(address)?.forEach(cb => cb(value));
  }

  // --- meter -----------------------------------------------------------------

  /** Richiede al mixer un gruppo di meter (es. '/meters/4' per l'RTA). Restituisce la funzione di rilascio. */
  subscribeMeters(path) {
    const n = this.meterSubs.get(path) ?? 0;
    this.meterSubs.set(path, n + 1);
    if (!n && this.ip) this.t.send('/meters', [{ type: 's', value: path }]);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = this.meterSubs.get(path) - 1;
      if (left > 0) this.meterSubs.set(path, left);
      else this.meterSubs.delete(path); // il mixer smette di inviarli entro 10 s
    };
  }

  /** cb(values: Float32Array in dB) a ogni pacchetto del gruppo di meter indicato. */
  onMeters(path, cb) {
    let set = this.meterListeners.get(path);
    if (!set) this.meterListeners.set(path, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }

  // --- connessione -----------------------------------------------------------

  onStatus(cb) {
    this.statusListeners.add(cb);
    cb(this.status, this.info);
    return () => this.statusListeners.delete(cb);
  }

  _setStatus(status) {
    this.status = status;
    this.statusListeners.forEach(cb => cb(status, this.info));
  }

  async connect(ip, addresses) {
    this.disconnect();
    this.ip = ip;
    this.addresses = addresses;
    this.connectStart = Date.now();
    this._setStatus('connecting');
    await this.t.connect(ip);
    this._ping();
    this.query(addresses);
    this.tick = setInterval(() => this._tick(), 1000);
  }

  disconnect() {
    clearInterval(this.tick);
    if (this.ip) this.t.disconnect();
    this.ip = null;
    this.info = null;
    this.queryQueue.length = 0;
    this.awaiting?.clear();
    clearTimeout(this.retryTimer);
    this.clearHistory();
    this.meters.fill(-128);
    if (this.status !== 'disconnected') this._setStatus('disconnected');
  }

  resubscribe() {
    this._ping();
    this.query(this.addresses);
  }

  _ping() {
    this.lastPing = Date.now();
    this.t.send('/xremote');
    for (const path of this.meterSubs.keys()) this.t.send('/meters', [{ type: 's', value: path }]);
    this.t.send('/xinfo');
  }

  _tick() {
    const now = Date.now();
    if (now - this.lastPing >= KEEPALIVE_MS) this._ping();
    if (this.status === 'online' && now - this.lastRx > TIMEOUT_MS) {
      this.meters.fill(-128);
      this._setStatus('lost');
    } else if (this.status === 'connecting' && now - this.connectStart > 5000) {
      this._setStatus('lost');
    }
  }

  _receive({ address, args }) {
    this.lastRx = Date.now();
    if (this.status === 'connecting' || this.status === 'lost') {
      const wasLost = this.status === 'lost';
      this._setStatus('online');
      if (wasLost) this.resubscribe(); // riallinea lo stato dopo un'interruzione
    }

    if (address === '/xinfo') {
      const [ip, name, model, version] = args.map(a => a.value);
      this.info = { ip, name, model, version };
      this._setStatus(this.status);
      return;
    }
    if (address.startsWith('/meters/')) {
      const values = decodeMeters(args[0]?.value);
      if (!values) return;
      if (address === '/meters/1') this.meters.set(values.subarray(0, this.meters.length));
      this.meterListeners.get(address)?.forEach(cb => cb(values));
      return;
    }
    this.awaiting?.delete(address);
    if (this.held.has(address)) return; // l'utente lo sta muovendo: vale il suo valore
    const parts = MULTI_VALUE[address];
    if (parts && args.length === parts.length) {
      parts.forEach((k, i) => {
        this.types.set(`${address}/${k}`, args[i].type);
        this._store(`${address}/${k}`, args[i].value);
      });
    }
    if (args.length) {
      this.types.set(address, args[0].type);
      this._store(address, args[0].value);
    }
  }

  /** Tipo OSC con cui il mixer ha inviato un parametro (undefined se non ancora ricevuto). */
  typeOf(address) {
    return this.types.get(address);
  }
}
