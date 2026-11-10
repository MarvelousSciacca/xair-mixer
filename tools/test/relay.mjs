// Prove del collegamento tramite computer: il ripetitore (server/relay.js) e la sua accensione dal ponte,
// il trasporto UDP del telefono (saluto con il codice) e i codici QR (disegno e lettura).
// Porte di prova: simulatore 10033, ripetitore 10034, ponte 8099.
// Uso: cd tools/test && npm test

import dgram from 'node:dgram';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WS from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIM_PORT = 10033;
const RELAY_PORT = 10034;
const BRIDGE_PORT = 8099;
const { startSimulator } = await import(`${ROOT}/server/simulator.js`);
const { startBridge } = await import(`${ROOT}/server/bridge.js`);
const { startRelay, newKey, validKey, HELLO } = await import(`${ROOT}/server/relay.js`);
const { encode, decode } = await import(`${ROOT}/server/osc.js`);
const sim = startSimulator({ port: SIM_PORT });
const bridge = startBridge({ port: BRIDGE_PORT, host: '127.0.0.1', quiet: true, mixerPort: SIM_PORT, share: { port: RELAY_PORT } });
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Un "telefono": socket UDP che manda OSC al ripetitore e raccoglie le risposte. */
async function phone(port = RELAY_PORT) {
  const sock = dgram.createSocket('udp4');
  const got = [];
  sock.on('message', buf => got.push(...decode(buf)));
  await new Promise(r => sock.bind(0, '127.0.0.1', r));
  return {
    got,
    send: (address, args = []) => sock.send(encode(address, args), port, '127.0.0.1'),
    hello: key => sock.send(encode(HELLO, [{ type: 's', value: key }]), port, '127.0.0.1'),
    wait: async (pred, ms = 1500) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const m = got.find(pred);
        if (m) return m;
        await sleep(20);
      }
      return null;
    },
    close: () => sock.close(),
  };
}
const status = m => m?.args[0]?.value;

await test('codice: 8 caratteri senza lettere ambigue', async () => {
  for (let i = 0; i < 50; i++) assert(validKey(newKey()), 'codice non valido');
  assert(!validKey('ABCD1234') && !validKey('abcdefgh') && !validKey(''), 'codici sbagliati accettati');
});

await test('ripetitore: senza codice ignora, con il codice gira al mixer e torna', async () => {
  const key = newKey();
  let clients = 0;
  const relay = startRelay({ key, port: RELAY_PORT, host: '127.0.0.1', mixer: () => ({ address: '127.0.0.1', port: SIM_PORT }), onChange: n => { clients = n; } });
  await relay.ready;
  const p = await phone();
  try {
    p.send('/xinfo');
    assert(!(await p.wait(m => m.address === '/xinfo', 400)), 'risposto senza saluto');
    p.hello(key);
    assert(status(await p.wait(m => m.address === HELLO)) === 'ok', 'saluto non accettato');
    assert(clients === 1, `telefoni collegati: ${clients}`);
    p.send('/xinfo');
    const info = await p.wait(m => m.address === '/xinfo');
    assert(info && info.args[2]?.value === 'XR18', 'il mixer non ha risposto attraverso il computer');
    p.send('/ch/01/mix/fader', [{ type: 'f', value: 0.25 }]);
    await sleep(150);
    assert(Math.abs(sim.state.get('/ch/01/mix/fader')?.value - 0.25) < 1e-6, 'comando non arrivato al mixer');
  } finally {
    p.close();
    relay.close();
  }
});

await test('ripetitore: codice sbagliato rifiutato, computer senza mixer segnalato', async () => {
  let target = null;
  const relay = startRelay({ key: 'ABCDEFGH', port: RELAY_PORT, host: '127.0.0.1', mixer: () => target });
  await relay.ready;
  const p = await phone();
  try {
    p.hello('HGFEDCBA');
    assert(status(await p.wait(m => m.address === HELLO)) === 'bad-key', 'codice sbagliato accettato');
    p.got.length = 0;
    p.hello('ABCDEFGH');
    assert(status(await p.wait(m => m.address === HELLO)) === 'no-mixer', 'mixer mancante non segnalato');
    assert(relay.clients === 1, 'telefono non registrato');
  } finally {
    p.close();
    relay.close();
  }
});

await test('ripetitore: dopo 5 codici sbagliati l\'indirizzo viene ignorato', async () => {
  const relay = startRelay({ key: 'ABCDEFGH', port: RELAY_PORT, host: '127.0.0.1', mixer: () => null });
  await relay.ready;
  const p = await phone();
  try {
    for (let i = 0; i < 5; i++) p.hello('ZZZZZZZZ');
    await sleep(200);
    p.got.length = 0;
    p.hello('ABCDEFGH'); // anche quello giusto, per un minuto
    assert(!(await p.wait(m => m.address === HELLO, 400)), 'tentativi non limitati');
  } finally {
    p.close();
    relay.close();
  }
});

/** Finestra dell'app per computer: WebSocket al ponte, messaggi JSON raccolti. */
async function desktop() {
  const ws = new WS(`ws://127.0.0.1:${BRIDGE_PORT}/ws`);
  const got = [];
  ws.on('message', d => got.push(JSON.parse(d)));
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  return {
    got,
    send: o => ws.send(JSON.stringify(o)),
    wait: async (pred, ms = 1500) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const m = got.find(pred);
        if (m) return m;
        await sleep(20);
      }
      return null;
    },
    close: () => ws.close(),
  };
}

await test('ponte: la finestra del computer accende la condivisione e i telefoni arrivano al suo mixer', async () => {
  const d = await desktop();
  const p = await phone();
  try {
    assert((await d.wait(m => m.type === 'hello'))?.share === true, 'condivisione non offerta');
    const key = newKey();
    d.send({ type: 'share', on: true, key });
    const on = await d.wait(m => m.type === 'share' && m.on);
    assert(on && on.key === key && on.port === RELAY_PORT && Array.isArray(on.ips), 'condivisione non accesa');
    p.hello(key);
    assert(status(await p.wait(m => m.address === HELLO)) === 'no-mixer', 'il computer non è ancora collegato');
    assert(await d.wait(m => m.type === 'share' && m.clients === 1), 'telefono non mostrato nella finestra');
    d.send({ type: 'connect', ip: '127.0.0.1' });
    await sleep(100);
    p.got.length = 0;
    p.hello(key);
    assert(status(await p.wait(m => m.address === HELLO)) === 'ok', 'collegamento non segnalato');
    p.send('/xinfo');
    assert(await p.wait(m => m.address === '/xinfo'), 'il mixer del computer non risponde al telefono');
    d.send({ type: 'share', on: false });
    assert(await d.wait(m => m.type === 'share' && !m.on), 'condivisione non spenta');
    await sleep(100);
    p.got.length = 0;
    p.send('/xinfo');
    assert(!(await p.wait(m => m.address === '/xinfo', 400)), 'il ripetitore è ancora acceso');
  } finally {
    p.close();
    d.close();
  }
});

await test('ponte: condivisione negata senza codice valido, chiusa con la finestra', async () => {
  const d = await desktop();
  d.send({ type: 'share', on: true, key: 'corto' });
  assert((await d.wait(m => m.type === 'share'))?.error === 'bad-key', 'codice non valido accettato');
  d.send({ type: 'share', on: true, key: 'ABCDEFGH' });
  assert(await d.wait(m => m.type === 'share' && m.on), 'condivisione non accesa');
  d.close();
  await sleep(200);
  // la porta torna libera: un nuovo ripetitore ci si può mettere
  const relay = startRelay({ key: 'ABCDEFGH', port: RELAY_PORT, host: '127.0.0.1', mixer: () => null });
  await relay.ready.then(() => relay.close(), () => { throw new Error('ripetitore rimasto acceso dopo la chiusura della finestra'); });
});

await test('telefono: UdpTransport si presenta con il codice e poi saluta di continuo', async () => {
  const { UdpTransport } = await import(`${ROOT}/public/js/transport-udp.js`);
  const { encode: enc, decode: dec, toBase64, fromBase64 } = await import(`${ROOT}/public/js/osc.js`);
  const sent = [];
  let listener = null;
  const plugin = {
    addListener: async (_e, cb) => { listener = cb; },
    open: async () => {},
    send: async ({ host, data }) => {
      const [m] = dec(fromBase64(data));
      sent.push({ host, ...m });
      if (m.address === HELLO) setTimeout(() => listener({ host, data: toBase64(enc(HELLO, [{ type: 's', value: m.args[0].value === 'GOODKEY2' ? 'ok' : 'bad-key' }])) }), 5);
    },
  };
  const t = new UdpTransport(plugin);
  assert(await t.probeRelay('10.0.0.5', 'GOODKEY2') === 'ok', 'risposta ok non letta');
  assert(await t.probeRelay('10.0.0.5', 'WRONGKEY') === 'bad-key', 'risposta bad-key non letta');
  const relayStatus = [];
  t.onRelay = s => relayStatus.push(s);
  const msgs = [];
  t.onMessage = m => msgs.push(m);
  t.keys.set('10.0.0.5', 'GOODKEY2');
  sent.length = 0;
  await t.connect('10.0.0.5');
  assert(sent[0]?.address === HELLO && sent[0].host === '10.0.0.5', 'nessun saluto prima dei comandi');
  await sleep(30);
  assert(relayStatus.includes('ok') && !msgs.some(m => m.address === HELLO), 'il saluto è arrivato all\'app come messaggio del mixer');
  t.disconnect();
  sent.length = 0;
  await t.connect('192.168.1.50'); // mixer vero: nessun saluto
  assert(!sent.some(m => m.address === HELLO), 'saluto mandato a un mixer');
  t.disconnect();
});

await test('QR: il codice disegnato si rilegge', async () => {
  const { default: qrcode } = await import(`${ROOT}/public/vendor/qrcode.js`);
  const { default: jsQR } = await import(`${ROOT}/public/vendor/jsqr.js`);
  const text = 'airdesk://pc?ip=192.168.1.10,10.0.0.2&k=ABCD2345';
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), s = 4, b = 4, W = (n + 2 * b) * s;
  const px = new Uint8ClampedArray(W * W * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!q.isDark(r, c)) continue;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = (((r + b) * s + y) * W + (c + b) * s + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  assert(jsQR(px, W, W)?.data === text, 'lettura sbagliata');
});

bridge.close();
sim.close();
console.log(failed ? `\n${failed} prove fallite` : '\ntutte le prove del collegamento tramite computer passate');
process.exit(failed ? 1 : 0);
