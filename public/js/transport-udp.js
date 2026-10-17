// Trasporto per le app (Android, poi iOS): UDP nativo tramite il plugin Capacitor "XAirUdp"
// (android/.../UdpPlugin.java). Stessa interfaccia di WebSocketTransport, senza ponte Node.

import { encode, decode, toBase64, fromBase64 } from './osc.js';

const MIXER_PORT = 10024;
const MAX_SWEEP = 1024; // indirizzi interrogati uno per uno al massimo (rete /22)

const ipToInt = ip => ip.split('.').reduce((n, b) => (n << 8) + Number(b), 0) >>> 0;
const intToIp = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');

/**
 * Tutti gli indirizzi della rete di un'interfaccia (escluso il proprio), se la rete non è troppo grande.
 * Su iOS il broadcast richiede un permesso speciale di Apple: così il mixer si trova lo stesso.
 */
export function sweepAddresses({ ip, netmask }) {
  if (!ip || !netmask) return [];
  const mask = ipToInt(netmask);
  const size = (~mask >>> 0) + 1;
  if (size < 4 || size > MAX_SWEEP) return [];
  const net = ipToInt(ip) & mask;
  const out = [];
  for (let i = 1; i < size - 1; i++) {
    const a = intToIp((net + i) >>> 0);
    if (a !== ip) out.push(a);
  }
  return out;
}

export class UdpTransport {
  /** udp: il plugin nativo (open, send, broadcastAddresses, addListener). */
  constructor(udp) {
    this.udp = udp;
    this.target = null;
    this.discovery = null;
    this.onMessage = () => {};
    this.onStatus = () => {};
    this.isOpen = false;
    this._ready = this._open();
  }

  async _open() {
    await this.udp.addListener('packet', ({ host, data }) => this._packet(host, fromBase64(data)));
    await this.udp.open();
    this.isOpen = true;
    this.onStatus('open');
  }

  async ready() {
    await this._ready;
  }

  _packet(host, bytes) {
    let messages;
    try {
      messages = decode(bytes);
    } catch {
      return;
    }
    for (const m of messages) {
      if (this.discovery && m.address === '/xinfo') {
        const [, name, model, version] = m.args.map(a => a.value);
        this.discovery.set(host, { ip: host, name, model, version });
      }
      if (host === this.target) this.onMessage(m);
    }
  }

  _sendTo(host, address, args) {
    let data;
    try {
      data = toBase64(encode(address, args));
    } catch {
      return;
    }
    this.udp.send({ host, port: MIXER_PORT, data }).catch(() => {});
  }

  async discover(timeout = 1500) {
    await this.ready();
    const found = new Map();
    this.discovery = found;
    const { addresses } = await this.udp.broadcastAddresses();
    for (const host of addresses) this._sendTo(host, '/xinfo', []);
    // interrogazione indirizzo per indirizzo della rete Wi-Fi (disponibile sul plugin iOS)
    const ifaces = await this.udp.interfaces?.().then(r => r.interfaces, () => []) ?? [];
    for (const ni of ifaces.filter(n => /^en\d/.test(n.name ?? ''))) {
      const hosts = sweepAddresses(ni);
      for (let i = 0; i < hosts.length; i++) {
        this._sendTo(hosts[i], '/xinfo', []);
        if (i % 64 === 63) await new Promise(r => setTimeout(r, 10)); // non inondare la rete
      }
    }
    await new Promise(r => setTimeout(r, timeout));
    if (this.discovery === found) this.discovery = null;
    return [...found.values()];
  }

  async connect(ip) {
    this.target = ip;
    await this.ready();
  }

  disconnect() {
    this.target = null;
  }

  send(address, args = []) {
    if (this.target) this._sendTo(this.target, address, args);
  }
}
