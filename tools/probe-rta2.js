// Diagnostica 5: numerazione delle sorgenti RTA 17-40 (ritorni FX, bus, mandate FX, main).
// UNICA MODIFICA: la sorgente dell'analizzatore RTA (/-stat/rta/source), riportata al valore originale.
// Prima di ogni sorgente l'RTA torna su un canale muto finché lo spettro non è sceso al minimo:
// così ogni livello misurato è segnale vero e non la coda della sorgente precedente.
// Serve musica su un canale mandato al Main LR, al Bus 1 e all'effetto 1.
// Uso: node tools/probe-rta2.js [--ip=192.168.1.9] [--port=10024] [--out=rapporto.txt]

import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import { encode, decode } from '../server/osc.js';

const PORT = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? 10024);
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const outFile = arg('out');
let mixerIp = arg('ip') ?? null;
const lines = [];
const log = (...p) => { const l = p.join(' '); lines.push(l); console.log(l); };
const save = () => { if (outFile) { fs.writeFileSync(outFile, `${lines.join('\n')}\n`); console.log(`\nRapporto salvato in: ${outFile}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');

// Sorgente RTA impostata da noi: se il mixer ne annuncia un'altra, la sta cambiando un'altra app.
let expected = null;
const foreign = [];
const sock = dgram.createSocket('udp4');
const replies = new Map();
const found = new Map();
let lastMeters1 = null;
let rtaFrames = [];
sock.on('message', (buf, rinfo) => {
  let msgs;
  try { msgs = decode(buf); } catch { return; }
  for (const m of msgs) {
    if (m.address === '/xinfo') found.set(rinfo.address, m.args.map(a => a.value));
    const b = m.args[0]?.value;
    const shorts = () => Array.from({ length: (b.length - 4) >> 1 }, (_, i) => b.readInt16LE(4 + i * 2) / 256);
    if (m.address === '/meters/1') { lastMeters1 = shorts(); continue; }
    if (m.address === '/meters/4') { rtaFrames.push(shorts()); continue; }
    replies.set(m.address, m.args);
    if (m.address === '/-stat/rta/source' && expected !== null && m.args[0]?.value !== expected) foreign.push(m.args[0]?.value);
  }
});
await new Promise(r => sock.bind(0, r));
sock.setBroadcast(true);
const send = (address, args = [], ip = mixerIp) => sock.send(encode(address, args), PORT, ip, () => {});

log('== DIAGNOSTICA 5 (sorgenti RTA) ==', new Date().toISOString());
const targets = new Set(['255.255.255.255', '192.168.1.1']);
for (const ni of Object.values(os.networkInterfaces()).flat()) {
  if (ni?.family !== 'IPv4' || ni.internal) continue;
  const ip = ni.address.split('.').map(Number), mask = ni.netmask.split('.').map(Number);
  targets.add(ip.map((x, i) => x | (~mask[i] & 255)).join('.'));
}
if (mixerIp) targets.add(mixerIp);
for (let a = 0; a < 3 && !found.size; a++) {
  for (const t of targets) send('/xinfo', [], t);
  await sleep(1500);
}
mixerIp ??= [...found.keys()].find(ip => ip !== '127.0.0.1');
if (!mixerIp) { log('Nessun mixer trovato.'); save(); process.exit(1); }
log('Mixer:', mixerIp, (found.get(mixerIp) ?? []).join(' | '));

const powerSum = v => 10 * Math.log10(v.reduce((s, x) => s + 10 ** (x / 10), 0) || 1e-13);
const subscribe = () => {
  send('/xremote');
  send('/meters', [{ type: 's', value: '/meters/1' }]);
  send('/meters', [{ type: 's', value: '/meters/4' }]);
};
const setSource = n => (expected = n, send('/-stat/rta/source', [{ type: 'i', value: n }]));
const read = async a => { replies.delete(a); for (let i = 0; i < 4 && !replies.has(a); i++) { send(a); await sleep(400); } return replies.get(a)?.[0]?.value; };

const original = await read('/-stat/rta/source');
log('Sorgente RTA originale:', original);
subscribe();
await sleep(800);

// Controllo: nessun'altra app deve cambiare la sorgente RTA durante la prova.
expected = original;
log('Controllo altre app collegate (5 s)...');
for (let i = 0; i < 5; i++) {
  send('/-stat/rta/source');
  await sleep(1000);
}
if (foreign.length) {
  log(`FERMATA: un'altra app sta cambiando la sorgente RTA (valori ${[...new Set(foreign)].join(', ')}).`);
  log('Chiudi X-AIR-Edit e X Air Mixer su tutti i dispositivi (Mac, telefono, tablet), poi rilancia.');
  save();
  process.exit(1);
}
log('Nessuna altra app: si parte.');
const meters = () => (lastMeters1 ?? []).map(Math.round);
const m0 = meters();
log('Livelli /meters/1 (0-39):', m0.join(' '));
log('  (0-15 canali, 16-17 aux, 18-25 ritorni FX L/R, 26-31 bus, 32-35 mandate FX, 36-37 main, 38-39 monitor)');

// canale di riferimento: il più silenzioso tra 1-16
const ref = m0.slice(0, 16).reduce((best, v, i) => (v < m0[best] ? i : best), 0);
log('Canale di riferimento (muto): sorgente', ref, `(Ch ${ref + 1}, ${m0[ref]} dB)`);

const settle = async () => {
  setSource(ref);
  const start = Date.now();
  let total = 0;
  while (Date.now() - start < 6000) {
    rtaFrames = [];
    await sleep(250);
    const f = rtaFrames.at(-1);
    if (f && (total = powerSum(f)) < -95) return total;
  }
  return total;
};

log('\nsorgente: livello RTA (media 1 s) | spettro dopo il riferimento | meter /meters/1 nello stesso momento');
for (let n = 16; n <= 40; n++) {
  subscribe();
  const floor = await settle();
  setSource(n);
  await sleep(150);
  rtaFrames = [];
  await sleep(1000);
  const frames = rtaFrames.slice();
  if (!frames.length) { log(`${n}: nessun dato (riferimento ${floor.toFixed(0)} dB)`); continue; }
  const foreignNow = foreign.splice(0);
  const totals = frames.map(powerSum);
  const avg = totals.reduce((s, x) => s + x, 0) / totals.length;
  log(`${n}: ${avg.toFixed(1)} dB (min ${Math.min(...totals).toFixed(0)}, max ${Math.max(...totals).toFixed(0)}, frame ${frames.length}, riferimento ${floor.toFixed(0)} dB)${foreignNow.length ? ` ⚠ ALTRA APP: ${foreignNow.join(',')}` : ''} | meter ${meters().join(' ')}`);
}

if (original !== undefined) setSource(original);
expected = null;
await sleep(300);
log(`\nSorgente RTA ripristinata: ${await read('/-stat/rta/source')} (originale ${original})`);
save();
process.exit(0);
