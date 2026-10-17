// Diagnostica 4: sorgenti d'ingresso, automix, parametri degli effetti, sorgenti RTA 17-31.
// MODIFICHE (innocue, ripristinate alla fine):
//  - sorgente dell'analizzatore RTA (/-stat/rta/source), come nella Diagnostica 2;
//  - automix X acceso per un attimo e poi rispento, SOLO se nessun canale è nel gruppo X
//    (senza canali assegnati l'automix non fa nulla).
// Non tocca sorgenti, livelli né effetti: quelli vengono solo letti.
// Uso: node tools/probe-src.js [--ip=192.168.1.9] [--out=rapporto.txt]

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
  }
});
await new Promise(r => sock.bind(0, r));
sock.setBroadcast(true);
const send = (address, args = [], ip = mixerIp) => sock.send(encode(address, args), PORT, ip, () => {});

log('== DIAGNOSTICA 4 (sorgenti, automix, effetti, RTA 17-31) ==', new Date().toISOString());
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

// --- 1. sola lettura -------------------------------------------------------------------------
const query = async list => {
  for (let i = 0; i < list.length; i += 16) {
    for (const a of list.slice(i, i + 16)) send(a);
    await sleep(30);
  }
  await sleep(1500);
};
const queryAll = async list => {
  await query(list);
  for (let round = 0; round < 4; round++) await query(list.filter(x => !replies.has(x))); // Wi-Fi: ripete i persi
};
const fmt = a => (replies.has(a) ? replies.get(a).map(x => `${x.type}:${typeof x.value === 'number' ? +x.value.toFixed(4) : JSON.stringify(x.value)}`).join(' ') : '--');
const ch = Array.from({ length: 16 }, (_, i) => `/ch/${pad(i + 1)}`);
const info = [
  '/config/amixenable', '/config/amixenable/X', '/config/amixenable/Y', '/config/amixlock', '/config/amixlock/X',
  ...ch.flatMap(c => [`${c}/automix/group`, `${c}/automix/weight`, `${c}/preamp/rtntrim`, `${c}/preamp/rtnsw`, `${c}/config/insrc`, `${c}/config/rtnsrc`]),
  '/rtn/aux/preamp/rtntrim', '/rtn/aux/preamp/rtnsw', '/rtn/aux/config/rtnsrc', '/rtn/aux/config/insrc',
  ...[1, 2, 3, 4].flatMap(n => [`/fx/${n}/type`, ...Array.from({ length: 64 }, (_, i) => `/fx/${n}/par/${pad(i + 1)}`)]),
  '/-stat/rta/source',
];
await queryAll(info);
log('\n== INFORMAZIONI (sola lettura) ==');
for (const a of info) if (replies.has(a)) log(a, fmt(a));
log('Senza risposta:', info.filter(a => !replies.has(a)).join(' ') || 'nessuno');

// --- 2. automix: scrittura del sotto-indirizzo /config/amixenable/X -----------------------------
log('\n== AUTOMIX: prova di scrittura ==');
const groupX = ch.filter(c => replies.get(`${c}/automix/group`)?.[0]?.value === 1);
const enable = replies.get('/config/amixenable')?.map(x => x.value);
if (!enable) log('Saltata: /config/amixenable non letto.');
else if (groupX.length) log('Saltata: ci sono canali nel gruppo X:', groupX.join(' '));
else if (enable[0] !== 0) log('Saltata: automix X già acceso.');
else {
  const readNode = async () => { replies.delete('/config/amixenable'); send('/config/amixenable'); await sleep(600); return fmt('/config/amixenable'); };
  send('/config/amixenable/X', [{ type: 'i', value: 1 }]);
  await sleep(400);
  log('Dopo /config/amixenable/X 1:', await readNode());
  send('/config/amixenable/X', [{ type: 'i', value: 0 }]);
  await sleep(400);
  let after = await readNode();
  if (after !== 'i:0 i:' + enable[1]) { // ripristino di sicurezza con il nodo completo
    send('/config/amixenable', [{ type: 'i', value: 0 }, { type: 'i', value: enable[1] }]);
    await sleep(400);
    after = await readNode();
  }
  log('Ripristinato:', after, `(originale i:${enable[0]} i:${enable[1]})`);
}

// --- 3. sorgenti RTA 17-31 (ritorni FX, bus, mandate, main) ----------------------------------
const original = replies.get('/-stat/rta/source')?.[0]?.value;
log(`\n== RTA 17-31: sorgente originale ${original} ==`);
const powerSum = v => 10 * Math.log10(v.reduce((s, x) => s + 10 ** (x / 10), 0) || 1e-13);
for (let src = 17; src <= 31; src++) {
  { // rinnovo a ogni sorgente: le iscrizioni scadono dopo 10 s
    send('/xremote');
    send('/meters', [{ type: 's', value: '/meters/1' }]);
    send('/meters', [{ type: 's', value: '/meters/4' }]);
  }
  send('/-stat/rta/source', [{ type: 'i', value: src }]);
  await sleep(1300); // lascia esaurire la coda della sorgente precedente (~20 dB/s)
  rtaFrames = [];
  await sleep(400);
  const frames = rtaFrames.slice();
  const meters = (lastMeters1 ?? []).map(Math.round);
  if (!frames.length) { log(`${src}: nessun dato`); continue; }
  const avg = frames[0].map((_, i) => frames.reduce((s, f) => s + f[i], 0) / frames.length);
  log(`${src}: totale ${powerSum(avg).toFixed(1)} dB, frame ${frames.length} | meter1 ${meters.join(' ')}`);
}
if (original !== undefined) send('/-stat/rta/source', [{ type: 'i', value: original }]);
await sleep(300);
replies.delete('/-stat/rta/source');
send('/-stat/rta/source');
await sleep(500);
log(`Sorgente RTA ripristinata: ${fmt('/-stat/rta/source')} (originale ${original})`);
save();
process.exit(0);
