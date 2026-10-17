// Link stereo: coppie di canali (1-2 … 15-16) e di bus (1-2, 3-4, 5-6).
// Quando una coppia è collegata, ogni modifica a un canale viene applicata anche all'altro
// (tranne nome, colore e pan); il pan diventa un bilanciamento della coppia.
// Le mandate verso due bus collegati si muovono insieme.

import { paramMap, oscType } from './params.js';
import { soloAddress } from './model.js';

const pad2 = n => String(n).padStart(2, '0');
// La sorgente d'ingresso resta propria di ogni canale (In 1 e In 2 restano distinti).
const EXCLUDED = new Set(['config/name', 'config/color', 'mix/pan', 'config/insrc', 'config/rtnsrc']);
const BASIC_TYPES = { 'mix/fader': 'f', 'mix/on': 'i' };

export class Links {
  constructor(mixer, strips) {
    this.mixer = mixer;
    this.listeners = new Set();
    this.pairs = [];
    this.byId = new Map();
    const byId = id => strips.find(s => s.id === id);

    for (let i = 1; i < 16; i += 2) {
      const a = byId(`ch${i}`), b = byId(`ch${i + 1}`);
      this._addPair({
        a, b, label: `Ch ${i}-${i + 1}`, address: `/config/chlink/${i}-${i + 1}`,
        prefixes: [[`${a.base}/`, `${b.base}/`], [`/headamp/${pad2(i)}/`, `/headamp/${pad2(i + 1)}/`]],
      });
    }
    for (let i = 1; i < 6; i += 2) {
      const a = byId(`bus${i}`), b = byId(`bus${i + 1}`);
      this._addPair({ a, b, bus: i, label: `Bus ${i}-${i + 1}`, address: `/config/buslink/${i}-${i + 1}`, prefixes: [[`${a.base}/`, `${b.base}/`]] });
    }

    mixer.addSetHook((address, value, type) => this._mirror(address, value, type));
    for (const p of this.pairs) mixer.on(p.address, () => this._emit());
  }

  _addPair(p) {
    this.pairs.push(p);
    this.byId.set(p.a.id, p);
    this.byId.set(p.b.id, p);
  }

  addresses() {
    return this.pairs.map(p => p.address);
  }

  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _emit() {
    this.listeners.forEach(cb => cb());
  }

  pair(strip) {
    return this.byId.get(strip.id) ?? null;
  }

  isLinked(strip) {
    const p = this.pair(strip);
    return !!(p && this.mixer.get(p.address, 0));
  }

  /** Il canale dispari è quello che rappresenta la coppia nell'interfaccia. */
  isPrimary(strip) {
    return this.pair(strip)?.a === strip;
  }

  pairLabel(strip) {
    return this.pair(strip)?.label ?? strip.label;
  }

  /** Bus che rappresenta n quando i bus sono collegati (2 -> 1 se 1-2 è in link). */
  primaryBus(n) {
    const p = this.pairs.find(x => x.bus && (x.bus === n || x.bus + 1 === n));
    return p && this.mixer.get(p.address, 0) ? p.bus : n;
  }

  /** Attiva o disattiva il link; attivandolo copia le impostazioni del primo canale sul secondo. */
  setLinked(strip, on) {
    const p = this.pair(strip);
    if (!p) return;
    this.mixer.set(p.address, on ? 1 : 0, 'i');
    if (!on) return;
    const specs = paramMap(p.a);
    for (const [from, to] of p.prefixes) {
      for (const [address, value] of this.mixer.values) {
        if (!address.startsWith(from)) continue;
        const rest = address.slice(from.length);
        if (EXCLUDED.has(rest)) continue;
        const spec = specs.get(address);
        const type = spec ? oscType(spec) : BASIC_TYPES[rest] ?? (typeof value === 'string' ? 's' : 'f');
        this.mixer.set(to + rest, value, type);
      }
    }
    // Coppia stereo: primo a sinistra, secondo a destra.
    if (p.a.pan) this.setBalance(p.a, 0.5);
  }

  // --- bilanciamento della coppia (pan dei due canali) -----------------------------------------

  balance(strip) {
    const p = this.pair(strip);
    const left = this.mixer.get(`${p.a.base}/mix/pan`, 0);
    const right = this.mixer.get(`${p.b.base}/mix/pan`, 1);
    return left > 0 ? (left + 1) / 2 : right / 2;
  }

  setBalance(strip, b) {
    const p = this.pair(strip);
    this.mixer.set(`${p.a.base}/mix/pan`, Math.max(0, 2 * b - 1));
    this.mixer.set(`${p.b.base}/mix/pan`, Math.min(1, 2 * b));
  }

  // --- specchio delle modifiche --------------------------------------------------------------------

  _mirror(address, value, type) {
    const out = [];
    for (const p of this.pairs) {
      if (!this.mixer.get(p.address, 0)) continue;
      for (const [x, y] of p.prefixes) {
        for (const [from, to] of [[x, y], [y, x]]) {
          if (!address.startsWith(from)) continue;
          const rest = address.slice(from.length);
          if (!EXCLUDED.has(rest)) out.push({ address: to + rest, value, type });
        }
      }
      if (p.a.solo && address === soloAddress(p.a)) out.push({ address: soloAddress(p.b), value, type });
      if (p.b.solo && address === soloAddress(p.b)) out.push({ address: soloAddress(p.a), value, type });
    }
    // Mandate verso bus collegati: livello e prelievo uguali sui due bus.
    const send = address.match(/^(.*\/mix\/)(\d\d)\/(level|tap)$/);
    if (send) {
      const n = Number(send[2]);
      const p = this.pairs.find(x => x.bus && (x.bus === n || x.bus + 1 === n));
      if (p && this.mixer.get(p.address, 0)) {
        const other = n === p.bus ? n + 1 : n - 1;
        out.push({ address: `${send[1]}${pad2(other)}/${send[3]}`, value, type });
      }
    }
    return out;
  }
}
