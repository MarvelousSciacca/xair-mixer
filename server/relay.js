// Ripetitore per telefoni e tablet: AirDesk per computer riceve l'OSC dei telefoni sulla porta del mixer
// (10024) e lo gira al mixer a cui il computer è collegato. Al telefono il computer sembra un mixer: l'app
// usa il suo UDP nativo di sempre, senza WebSocket né pagine web (niente blocchi di sicurezza dei WebView).
//
// Ogni telefono ha un suo socket verso il mixer, così il mixer lo vede come un client a parte (iscrizioni
// /xremote e /meters separate, come più copie di X-AIR-Edit). Entra solo chi si presenta con il codice
// mostrato nel QR: /airdesk/hello <codice>. La risposta è /airdesk/hello con "ok", "no-mixer" o "bad-key".

import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { encode, decode } from './osc.js';

export const HELLO = '/airdesk/hello';
export const RELAY_PORT = 10024;
const IDLE_MS = 30_000;      // telefono muto da 30 s: si chiude il suo socket (l'app saluta ogni 4 s)
const MAX_CLIENTS = 16;
const BAD_KEY_LIMIT = 5;     // codici sbagliati di fila prima di ignorare un indirizzo
const BAN_MS = 60_000;

// codice da 8 caratteri senza lettere che si confondono (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newKey() {
  return Array.from(crypto.randomBytes(8), b => ALPHABET[b % ALPHABET.length]).join('');
}
export const validKey = key => typeof key === 'string' && /^[A-Z2-9]{8}$/.test(key);

/**
 * mixer(): { address, port } del mixer a cui girare i pacchetti, o null se il computer non è collegato.
 * onChange(clients): numero di telefoni collegati, quando cambia.
 */
export function startRelay({ key, mixer, port = RELAY_PORT, host, onChange = () => {} }) {
  const server = dgram.createSocket('udp4');
  const clients = new Map(); // "ip:porta" -> { address, port, sock, last }
  const strikes = new Map(); // ip -> { n, until }
  let closed = false;

  const changed = () => onChange(clients.size);
  const answer = (rinfo, status) => {
    try {
      server.send(encode(HELLO, [{ type: 's', value: status }]), rinfo.port, rinfo.address);
    } catch { /* socket chiuso */ }
  };
  const drop = id => {
    const c = clients.get(id);
    if (!c) return;
    clients.delete(id);
    try { c.sock.close(); } catch { /* già chiuso */ }
    changed();
  };
  const admit = rinfo => {
    const id = `${rinfo.address}:${rinfo.port}`;
    let c = clients.get(id);
    if (c) return c;
    if (clients.size >= MAX_CLIENTS) return null;
    const sock = dgram.createSocket('udp4');
    c = { address: rinfo.address, port: rinfo.port, sock, last: Date.now() };
    sock.on('message', (buf, from) => {
      const m = mixer();
      // dal mixer al telefono, e solo dal mixer
      if (m && from.address === m.address && !closed) server.send(buf, c.port, c.address, () => {});
    });
    sock.on('error', () => drop(id));
    sock.bind(0);
    clients.set(id, c);
    changed();
    return c;
  };

  server.on('message', (buf, rinfo) => {
    const ban = strikes.get(rinfo.address);
    if (ban && ban.until > Date.now()) return;
    let messages;
    try {
      messages = decode(buf);
    } catch {
      return;
    }
    const hello = messages.find(m => m.address === HELLO);
    const id = `${rinfo.address}:${rinfo.port}`;
    if (hello) {
      if (hello.args[0]?.value !== key) {
        const s = strikes.get(rinfo.address) ?? { n: 0, until: 0 };
        s.n += 1;
        if (s.n >= BAD_KEY_LIMIT) Object.assign(s, { n: 0, until: Date.now() + BAN_MS });
        strikes.set(rinfo.address, s);
        drop(id);
        return answer(rinfo, 'bad-key');
      }
      strikes.delete(rinfo.address);
      const c = admit(rinfo);
      if (!c) return;
      c.last = Date.now();
      return answer(rinfo, mixer() ? 'ok' : 'no-mixer');
    }
    const c = clients.get(id);
    if (!c) return; // non si è presentato: ignorato
    c.last = Date.now();
    const m = mixer();
    if (m) c.sock.send(buf, m.port, m.address, () => {});
  });
  server.on('error', () => {}); // la porta occupata si segnala con ready

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, c] of clients) if (now - c.last > IDLE_MS) drop(id);
  }, 5000);
  sweep.unref?.();

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.bind(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });

  return {
    ready,
    get clients() { return clients.size; },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(sweep);
      for (const id of [...clients.keys()]) drop(id);
      try { server.close(); } catch { /* mai aperto */ }
    },
  };
}
