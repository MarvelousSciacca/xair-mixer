// Modifica senza mixer: un mixer "virtuale" dentro l'app che risponde come quello vero, così si
// preparano mix e scene a casa. Parte dall'ultimo mix visto sul mixer vero (o da un mix neutro) e
// salva ogni modifica sul dispositivo. Collegati al mixer, il lavoro si invia come una scena.

import { MULTI_VALUE, ROUTING, routingAddress, routingPosAddress } from './model.js';
import { stripParams, oscType, defaultValue } from './params.js';
import { FX_SLOTS, FX_PARAM_COUNT, fxParams, fxTypeAddress, fxParamAddress } from './fx.js';

export const OFFLINE_IP = 'senza-mixer';
const STATE_KEY = 'xair.offline';
export const LAST_MIX_KEY = 'xair.lastMix';
const SAVE_MS = 500;

/** Valore iniziale "neutro" di un parametro: fader a 0 dB, canali accesi, mandate chiuse… */
function neutralValue(address, specs) {
  const spec = specs.get(address);
  if (spec) return [oscType(spec), defaultValue(spec)];
  if (/\/config\/name$/.test(address)) return ['s', ''];
  if (/\/(mix\/)?fader$/.test(address)) return ['f', 0.75];
  if (/\/(mix\/)?on$/.test(address)) return ['i', 1];
  if (/\/mix\/pan$/.test(address)) return ['f', 0.5];
  if (/\/mix\/\d\d\/level$/.test(address)) return ['f', 0];
  if (/^\/-snap\/(name|\d\d\/name)$/.test(address)) return ['s', '']; // nomi degli snapshot e snapshot attuale
  return ['i', 0];
}

/** Mix neutro per tutti gli indirizzi dell'app. */
export function neutralState(addresses, strips) {
  const specs = new Map(strips.flatMap(s => stripParams(s).map(p => [p.address, p.spec])));
  const state = new Map(addresses.map(a => [a, neutralValue(a, specs)]));
  for (const r of ROUTING) {
    for (let n = 1; n <= r.count; n++) {
      state.set(routingAddress(r.id, n), ['i', r.id === 'aux' ? 25 + n : n - 1]); // come esce di fabbrica
      state.set(routingPosAddress(r.id, n), ['i', { aux: 10, usb: 0, p16: 2 }[r.id] ?? 0]);
    }
  }
  // effetti: tipo 0 (Hall) con i suoi valori; i parametri che non usa valgono NaN, come sul mixer
  const { params } = fxParams(0);
  for (const slot of FX_SLOTS) {
    state.set(fxTypeAddress(slot), ['i', 0]);
    for (let p = 0; p < FX_PARAM_COUNT; p++) state.set(fxParamAddress(slot, p), params[p] ? [oscType(params[p]), defaultValue(params[p])] : ['f', NaN]);
  }
  for (const [node, parts] of Object.entries(MULTI_VALUE)) for (const k of parts) state.set(`${node}/${k}`, ['i', 0]);
  return state;
}

/** Trasporto finto: stessa interfaccia di WebSocketTransport/UdpTransport, risponde da sé. */
export class OfflineTransport {
  constructor({ storage, addresses, strips }) {
    this.storage = storage;
    this.addresses = addresses;
    this.strips = strips;
    this.onMessage = () => {};
    this.onStatus = () => {};
    this.state = null;
    this.saveTimer = 0;
  }

  /** Il lavoro salvato, oppure l'ultimo mix del mixer vero, oppure un mix neutro. */
  _load() {
    const state = neutralState(this.addresses, this.strips);
    const saved = this._read(STATE_KEY) ?? this._read(LAST_MIX_KEY);
    if (saved) for (const [a, entry] of Object.entries(saved)) if (state.has(a)) state.set(a, entry);
    for (const slot of FX_SLOTS) this._fxShape(state, slot, saved ?? {});
    return state;
  }

  /**
   * Parametri di uno slot effetto coerenti col tipo, come sul mixer: quelli che il tipo non usa valgono
   * NaN, quelli che usa e non sono salvati prendono il valore iniziale. keep: valori da conservare.
   */
  _fxShape(state, slot, keep) {
    const { mapped, params } = fxParams(state.get(fxTypeAddress(slot))?.[1] ?? 0);
    if (!mapped) return;
    for (let p = 0; p < FX_PARAM_COUNT; p++) {
      const a = fxParamAddress(slot, p);
      if (!params[p]) state.set(a, ['f', NaN]);
      else if (!keep[a]) state.set(a, [oscType(params[p]), defaultValue(params[p])]);
    }
  }

  _read(key) {
    try {
      const d = JSON.parse(this.storage.get(key) ?? 'null');
      return d?.params && typeof d.params === 'object' ? d.params : null;
    } catch {
      return null;
    }
  }

  get hasWork() {
    return !!this._read(STATE_KEY);
  }

  /** Il lavoro come parametri di una scena ({ address: [tipo, valore] }), senza i NaN. */
  work() {
    const state = this.state ?? this._load();
    const params = {};
    for (const [a, [type, value]] of state) if (!(typeof value === 'number' && Number.isNaN(value)) && !a.startsWith('/-')) params[a] = [type, value];
    return params;
  }

  /** Ricomincia dall'ultimo mix visto sul mixer vero (o dal mix neutro). */
  reset() {
    this.storage.set(STATE_KEY, '');
    this.state = this._load();
  }

  _save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.storage.set(STATE_KEY, JSON.stringify({ params: this.work() })), SAVE_MS);
  }

  _reply(address, args) {
    queueMicrotask(() => this.onMessage({ address, args }));
  }

  async connect() {
    this.state = this._load();
  }

  disconnect() {}

  send(address, args = []) {
    const state = this.state ?? (this.state = this._load());
    if (address === '/xinfo') return this._reply('/xinfo', [OFFLINE_IP, 'Senza mixer', 'XR18', '—'].map(value => ({ type: 's', value })));
    if (address === '/xremote' || address === '/meters' || address.startsWith('/-action') || /^\/-snap\/(load|save|delete)$/.test(address)) return;
    if (args.length) {
      state.set(address, [args[0].type, args[0].value]);
      // cambiando tipo di effetto il mixer carica i valori iniziali del nuovo effetto: qui lo stesso
      const fx = address.match(/^\/fx\/(\d)\/type$/);
      if (fx) this._fxShape(state, Number(fx[1]), {});
      this._save();
      return;
    }
    const parts = MULTI_VALUE[address];
    if (parts) return this._reply(address, parts.map(k => ({ type: 'i', value: state.get(`${address}/${k}`)?.[1] ?? 0 })));
    const entry = state.get(address);
    if (entry) this._reply(address, [{ type: entry[0], value: entry[1] }]);
  }
}

/**
 * Trasporto che passa dal mixer vero a quello virtuale secondo l'indirizzo a cui ci si collega.
 * Il resto dell'app non vede differenze.
 */
export class SwitchTransport {
  constructor(real, offline) {
    this.real = real;
    this.offline = offline;
    this.current = real;
    this.onMessage = () => {};
    this._onStatus = () => {};
    for (const t of [real, offline]) t.onMessage = m => { if (t === this.current) this.onMessage(m); };
  }

  set onStatus(cb) {
    this._onStatus = cb;
    this.real.onStatus = cb;
  }

  get onStatus() {
    return this._onStatus;
  }

  get isOffline() {
    return this.current === this.offline;
  }

  discover(...args) {
    return this.real.discover(...args);
  }

  ready(...args) {
    return this.real.ready?.(...args);
  }

  async connect(ip) {
    const next = ip === OFFLINE_IP ? this.offline : this.real;
    if (next !== this.current) this.current.disconnect();
    this.current = next;
    return next.connect(ip);
  }

  disconnect() {
    this.current.disconnect();
  }

  send(address, args) {
    this.current.send(address, args);
  }
}
