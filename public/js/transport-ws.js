// Trasporto via browser: parla con il ponte Node (server/bridge.js) tramite WebSocket.
// Le versioni app (Electron/Capacitor) useranno un trasporto UDP nativo con la stessa interfaccia:
//   discover() -> Promise<[{ ip, name, model, version }]>
//   connect(ip), disconnect(), send(address, args)
//   onMessage({ address, args }), onStatus('open' | 'closed')

export class WebSocketTransport {
  constructor(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
    this.url = url;
    this.target = null;
    this.onMessage = () => {};
    this.onStatus = () => {};
    this._discoverResolve = null;
    this._open();
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  _open() {
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => {
      if (this.target) this._raw({ type: 'connect', ip: this.target });
      this.onStatus('open');
    };
    ws.onclose = () => {
      this.onStatus('closed');
      setTimeout(() => this._open(), 1500);
    };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'osc') {
        this.onMessage({ address: m.address, args: m.args });
      } else if (m.type === 'discovered' && this._discoverResolve) {
        this._discoverResolve(m.mixers);
        this._discoverResolve = null;
      }
    };
  }

  _raw(obj) {
    if (!this.isOpen) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  async ready(timeout = 5000) {
    const until = Date.now() + timeout;
    while (!this.isOpen) {
      if (Date.now() > until) throw new Error('Ponte non raggiungibile');
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async discover() {
    await this.ready();
    return new Promise(resolve => {
      this._discoverResolve = resolve;
      this._raw({ type: 'discover' });
      setTimeout(() => {
        if (this._discoverResolve === resolve) {
          this._discoverResolve = null;
          resolve([]);
        }
      }, 4000);
    });
  }

  async connect(ip) {
    this.target = ip;
    await this.ready();
    this._raw({ type: 'connect', ip });
  }

  disconnect() {
    this.target = null;
    this._raw({ type: 'disconnect' });
  }

  send(address, args = []) {
    this._raw({ type: 'osc', address, args });
  }
}
