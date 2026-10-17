// Ponte WebSocket <-> OSC/UDP. Serve anche l'interfaccia web dalla cartella public/.
// Ogni pagina aperta ha la sua sessione UDP verso il mixer, come un'istanza separata di X-AIR-Edit.

import http from 'node:http';
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { encode, decode } from './osc.js';

export const MIXER_PORT = 10024;

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

function ipv4Interfaces() {
  return Object.values(os.networkInterfaces()).flat().filter(ni => ni && ni.family === 'IPv4' && !ni.internal);
}

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const ni of ipv4Interfaces()) {
    const ip = ni.address.split('.').map(Number);
    const mask = ni.netmask.split('.').map(Number);
    out.add(ip.map((b, i) => b | (~mask[i] & 255)).join('.'));
  }
  return [...out];
}

// I blob viaggiano in JSON come base64.
const toWire = m => ({
  address: m.address,
  args: m.args.map(a => (a.type === 'b' ? { type: 'b', value: Buffer.from(a.value).toString('base64') } : a)),
});
const fromWire = (args = []) =>
  args.map(a => (a.type === 'b' ? { type: 'b', value: Buffer.from(a.value, 'base64') } : a));

class Session {
  constructor(ws) {
    this.ws = ws;
    this.target = null;
    this.discovery = null;
    this.udp = dgram.createSocket('udp4');
    this.udp.on('message', (buf, rinfo) => this.onUdp(buf, rinfo));
    this.udp.on('error', err => this.reply({ type: 'error', message: err.message }));
    this.ready = new Promise(resolve =>
      this.udp.bind(0, () => {
        this.udp.setBroadcast(true);
        resolve();
      }),
    );
    ws.on('message', data => this.onWs(data));
    ws.on('close', () => this.udp.close());
  }

  reply(obj) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(obj));
  }

  send(address, port, oscAddress, args) {
    let packet;
    try {
      packet = encode(oscAddress, args);
    } catch (err) {
      this.reply({ type: 'error', message: err.message });
      return;
    }
    this.udp.send(packet, port, address, () => {}); // errori di rete ignorati: UDP è "best effort"
  }

  async onWs(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    await this.ready;
    switch (msg.type) {
      case 'discover':
        this.discover(msg.timeout ?? 1500);
        break;
      case 'connect':
        this.target = { address: msg.ip, port: msg.port ?? MIXER_PORT };
        this.reply({ type: 'connected', ip: msg.ip });
        break;
      case 'disconnect':
        this.target = null;
        break;
      case 'osc':
        if (this.target) this.send(this.target.address, this.target.port, msg.address, fromWire(msg.args));
        break;
    }
  }

  discover(timeout) {
    const found = new Map();
    this.discovery = found;
    for (const addr of [...broadcastAddresses(), '127.0.0.1']) this.send(addr, MIXER_PORT, '/xinfo', []);
    setTimeout(() => {
      if (this.discovery === found) this.discovery = null;
      this.reply({ type: 'discovered', mixers: [...found.values()] });
    }, timeout);
  }

  onUdp(buf, rinfo) {
    let messages;
    try {
      messages = decode(buf);
    } catch {
      return;
    }
    for (const m of messages) {
      if (this.discovery && m.address === '/xinfo') {
        const [, name, model, version] = m.args.map(a => a.value);
        this.discovery.set(rinfo.address, { ip: rinfo.address, name, model, version });
      }
      if (this.target && rinfo.address === this.target.address) this.reply({ type: 'osc', ...toWire(m) });
    }
  }
}

export function startBridge({ port = 8080 } = {}) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', ws => new Session(ws));
  server.listen(port, () => {
    console.log(`\nX Air Mixer pronto:`);
    console.log(`  questo computer:  http://localhost:${port}`);
    for (const ni of ipv4Interfaces()) console.log(`  altri dispositivi: http://${ni.address}:${port}`);
    console.log('');
  });
  return server;
}
