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
const MAX_WS_PAYLOAD = 64 * 1024; // un messaggio OSC del mixer è di poche centinaia di byte
const MAX_OSC_ARGS = 16;

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

// --- sicurezza --------------------------------------------------------------------------------

/**
 * Il ponte risponde solo a nomi che non possono essere di un sito esterno: indirizzi IP, localhost e
 * nomi .local. Così una pagina web qualsiasi non può raggiungerlo con il "DNS rebinding".
 */
export function trustedHost(hostHeader = '') {
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost' || host === '::1' || /^[a-z0-9-]+\.local$/.test(host);
}

/** Il WebSocket accetta solo la pagina servita da questo stesso ponte (niente siti di terzi). */
export function trustedOrigin(origin, hostHeader) {
  if (!origin) return true; // programmi locali senza browser (es. le prove automatiche)
  try {
    const o = new URL(origin);
    return (o.protocol === 'http:' || o.protocol === 'https:') && o.host === hostHeader;
  } catch {
    return false;
  }
}

/**
 * Il ponte parla solo con dispositivi della rete locale: un mixer non sta mai su Internet.
 * Così non può essere usato per mandare pacchetti verso indirizzi esterni.
 */
export function isLocalIPv4(ip) {
  if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if ([a, b].some(n => n > 255)) return false;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

async function serveStatic(req, res) {
  if (!trustedHost(req.headers.host)) {
    res.writeHead(403, SECURITY_HEADERS).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' }).end();
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS).end(); // indirizzo malformato: prima faceva cadere il server
    return;
  }
  if (rel.includes('\0')) {
    res.writeHead(400, SECURITY_HEADERS).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, SECURITY_HEADERS).end();
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, SECURITY_HEADERS).end('Not found');
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
  constructor(ws, mixerPort) {
    this.ws = ws;
    this.mixerPort = mixerPort;
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
    if (!msg || typeof msg !== 'object') return;
    await this.ready;
    switch (msg.type) {
      case 'discover':
        this.discover(Math.min(5000, Math.max(200, Number(msg.timeout) || 1500)));
        break;
      case 'connect':
        // solo dispositivi della rete locale e solo la porta OSC del mixer
        if (!isLocalIPv4(msg.ip)) {
          this.reply({ type: 'error', message: 'Indirizzo non valido: il mixer deve essere sulla rete locale' });
          break;
        }
        this.target = { address: msg.ip, port: this.mixerPort };
        this.reply({ type: 'connected', ip: msg.ip });
        break;
      case 'disconnect':
        this.target = null;
        break;
      case 'osc':
        if (!this.target || typeof msg.address !== 'string' || !/^\/[\x21-\x7e]{0,127}$/.test(msg.address)) break;
        if (msg.args !== undefined && (!Array.isArray(msg.args) || msg.args.length > MAX_OSC_ARGS)) break;
        try {
          this.send(this.target.address, this.target.port, msg.address, fromWire(msg.args));
        } catch {
          /* argomenti malformati: ignorati */
        }
        break;
    }
  }

  discover(timeout) {
    const found = new Map();
    this.discovery = found;
    for (const addr of [...broadcastAddresses(), '127.0.0.1']) this.send(addr, this.mixerPort, '/xinfo', []);
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

/** mixerPort: porta OSC del mixer (diversa solo nelle prove automatiche con il simulatore). */
export function startBridge({ port = 8080, host, quiet = false, mixerPort = MIXER_PORT } = {}) {
  const server = http.createServer((req, res) => {
    serveStatic(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, SECURITY_HEADERS);
      res.end();
    });
  });
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_WS_PAYLOAD,
    verifyClient: ({ req }) => trustedHost(req.headers.host) && trustedOrigin(req.headers.origin, req.headers.host),
  });
  wss.on('connection', ws => new Session(ws, mixerPort));
  server.listen(port, host, () => {
    if (quiet) return;
    console.log(`\nAirDesk pronto:`);
    console.log(`  questo computer:  http://localhost:${port}`);
    for (const ni of ipv4Interfaces()) console.log(`  altri dispositivi: http://${ni.address}:${port}`);
    console.log('');
  });
  return server;
}
