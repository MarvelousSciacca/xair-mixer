// Prove di sicurezza del ponte (server/bridge.js): siti esterni, DNS rebinding, indirizzi fuori dalla
// rete locale, richieste malformate. Porta di prova 8098, nessun mixer coinvolto.
// Uso: cd tools/test && npm test

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WS from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8098;
const { startBridge, isLocalIPv4, trustedHost } = await import(`${ROOT}/server/bridge.js`);
const bridge = startBridge({ port: PORT, host: '127.0.0.1', quiet: true });
await new Promise(r => bridge.once('listening', r));

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

/** Apre il WebSocket con le intestazioni date: risolve 'open' o il codice HTTP di rifiuto. */
const wsTry = headers => new Promise(resolve => {
  const ws = new WS(`ws://127.0.0.1:${PORT}/ws`, { headers });
  ws.on('open', () => resolve({ status: 'open', ws }));
  ws.on('unexpected-response', (_, res) => resolve({ status: res.statusCode }));
  ws.on('error', () => resolve({ status: 'error' }));
});
const get = (p, { method = 'GET', host } = {}) => new Promise(resolve => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: host ? { Host: host } : {} },
    res => { res.resume(); res.on('end', () => resolve(res)); });
  req.on('error', e => resolve({ statusCode: 'error', error: e }));
  req.end();
});

await test('WebSocket: rifiutato da un sito esterno (Origin diverso)', async () => {
  const r = await wsTry({ Origin: 'https://sito-malevolo.example' });
  assert(r.status === 401 || r.status === 403, `stato ${r.status}`);
});

await test('WebSocket: rifiutato con DNS rebinding (Host = nome di dominio)', async () => {
  const r = await wsTry({ Host: `attacker.example:${PORT}`, Origin: `http://attacker.example:${PORT}` });
  assert(r.status === 401 || r.status === 403, `stato ${r.status}`);
});

await test('WebSocket: accettato dalla pagina del ponte stesso', async () => {
  const r = await wsTry({ Origin: `http://127.0.0.1:${PORT}` });
  assert(r.status === 'open', `stato ${r.status}`);
  // un indirizzo su Internet viene rifiutato: il ponte non fa da ripetitore UDP
  const reply = await new Promise(resolve => {
    r.ws.on('message', d => resolve(JSON.parse(d)));
    r.ws.send(JSON.stringify({ type: 'connect', ip: '8.8.8.8', port: 53 }));
  });
  assert(reply.type === 'error', `risposta ${JSON.stringify(reply)}`);
  r.ws.close();
});

await test('solo indirizzi della rete locale', async () => {
  for (const ip of ['192.168.1.9', '10.0.0.5', '172.20.1.1', '127.0.0.1', '169.254.3.4']) assert(isLocalIPv4(ip), `${ip} rifiutato`);
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '192.169.0.1', '300.1.1.1', 'localhost', '', null, '192.168.1.9:53'])
    assert(!isLocalIPv4(ip), `${ip} accettato`);
  for (const h of ['127.0.0.1:8080', 'localhost:47824', 'mixer.local', '[::1]:80']) assert(trustedHost(h), `${h} rifiutato`);
  for (const h of ['evil.com', 'evil.com:8080', '127.0.0.1.evil.com', '']) assert(!trustedHost(h), `${h} accettato`);
});

await test('HTTP: indirizzo malformato non fa cadere il server', async () => {
  const r = await get('/%E0%A4%A');
  assert(r.statusCode === 400, `stato ${r.statusCode}`);
  const ok = await get('/');
  assert(ok.statusCode === 200, `server non più raggiungibile (${ok.statusCode})`);
});

await test('HTTP: niente file fuori da public/', async () => {
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/js/%00.js']) {
    const r = await get(p);
    assert([400, 403, 404].includes(r.statusCode), `${p}: stato ${r.statusCode}`);
  }
});

await test('HTTP: intestazioni di sicurezza, solo GET/HEAD, Host fidato', async () => {
  const r = await get('/');
  assert(r.headers['x-content-type-options'] === 'nosniff' && r.headers['x-frame-options'] === 'DENY', 'intestazioni mancanti');
  assert((await get('/', { method: 'POST' })).statusCode === 405, 'POST accettato');
  assert((await get('/', { host: 'attacker.example' })).statusCode === 403, 'Host esterno accettato');
});

console.log(failed ? `\n${failed} prove di sicurezza fallite` : '\ntutte le prove di sicurezza passate');
bridge.close();
process.exit(failed ? 1 : 0);
