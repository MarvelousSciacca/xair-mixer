// Trasporto per le app (Android, poi iOS): UDP nativo tramite il plugin Capacitor "XAirUdp"
// (android/.../UdpPlugin.java). Stessa interfaccia di WebSocketTransport, senza ponte Node.

import { encode, decode, toBase64, fromBase64 } from './osc.js';

const MIXER_PORT = 10024;

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
