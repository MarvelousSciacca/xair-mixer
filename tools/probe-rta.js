// Diagnostica 2: numerazione delle sorgenti RTA e informazioni per la fase 4.
// UNICA MODIFICA: la sorgente dell'analizzatore RTA (/-stat/rta/source) viene cambiata a turno e
// alla fine riportata al valore originale. Non tocca l'audio.
// Serve segnale su qualche canale durante la prova (musica, voce, strumento).
// Uso: node tools/probe-rta.js [--ip=192.168.1.9] [--out=rapporto.txt]

import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import { encode, decode } from '../server/osc.js';

const PORT = 10024;
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

log('== DIAGNOSTICA 2 (RTA e fase 4) ==', new Date().toISOString());
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

// --- 1. informazioni in sola lettura -------------------------------------------------------
const query = async list => {
  for (let i = 0; i < list.length; i += 16) {
    for (const a of list.slice(i, i + 16)) send(a);
    await sleep(30);
  }
  await sleep(1500);
};
const fmt = a => (replies.has(a) ? replies.get(a).map(x => `${x.type}:${typeof x.value === 'number' ? +x.value.toFixed(4) : JSON.stringify(x.value)}`).join(' ') : '--');
const info = [
  ...['aux', '1', '2', '3', '4'].flatMap(r => [`/rtn/${r}/eq/on`, ...[1, 2, 3, 4, 5, 6].flatMap(b => [`/rtn/${r}/eq/${b}/type`, `/rtn/${r}/eq/${b}/f`])]),
  ...['aux', '1'].flatMap(r => [`/rtn/${r}/preamp/rtnsw`, `/rtn/${r}/config/rtnsrc`, `/rtn/${r}/dyn/on`, `/rtn/${r}/gate/on`, `/rtn/${r}/insert/on`]),
  '/fxsend/1/eq/on', '/fxsend/1/dyn/on', '/bus/1/eq/mode', '/lr/eq/mode',
  ...[1, 2, 3, 4].flatMap(n => [`/fx/${n}/insert`, `/fx/${n}/type`]),
  ...Array.from({ length: 16 }, (_, i) => [`/ch/${pad(i + 1)}/insert/on`, `/ch/${pad(i + 1)}/insert/sel`, `/ch/${pad(i + 1)}/config/insrc`, `/ch/${pad(i + 1)}/config/rtnsrc`, `/ch/${pad(i + 1)}/preamp/rtnsw`]).flat(),
  '/routing/main/01', '/routing/main/02',
  ...Array.from({ length: 6 }, (_, i) => `/routing/aux/${pad(i + 1)}`),
  ...Array.from({ length: 18 }, (_, i) => `/routing/usb/${pad(i + 1)}`),
  ...Array.from({ length: 16 }, (_, i) => `/routing/p16/${pad(i + 1)}`),
  ...Array.from({ length: 18 }, (_, i) => `/headamp/${pad(i + 1)}/gain`),
  ...Array.from({ length: 64 }, (_, i) => `/-snap/${pad(i + 1)}/name`),
  '/-snap/name', '/-snap/index', '/config/amixenable', '/config/amixlock', '/config/solo/source', '/config/solo/level',
  '/-stat/rta/source', '/-prefs/rta/det', '/-prefs/rta/decay',
];
await query(info);
for (let round = 0; round < 3; round++) await query(info.filter(x => !replies.has(x))); // Wi-Fi: ripete i persi
log('\n== INFORMAZIONI (sola lettura) ==');
for (const a of info) if (replies.has(a)) log(a, fmt(a));
log('Senza risposta:', info.filter(a => !replies.has(a)).join(' '));

// --- 2. numerazione sorgenti RTA --------------------------------------------------------------
const original = replies.get('/-stat/rta/source')?.[0]?.value;
log(`\n== RTA: sorgente originale ${original} ==`);
send('/meters', [{ type: 's', value: '/meters/1' }]);
send('/meters', [{ type: 's', value: '/meters/4' }]);
await sleep(500);
log('Livelli /meters/1 (0-39) all\'inizio:', (lastMeters1 ?? []).map(Math.round).join(' '));
const powerSum = v => 10 * Math.log10(v.reduce((s, x) => s + 10 ** (x / 10), 0) || 1e-13);
const results = [];
for (let src = 0; src <= 45; src++) {
  if (src % 10 === 0) { // rinnovo delle iscrizioni (scadono dopo 10 s)
    send('/xremote');
    send('/meters', [{ type: 's', value: '/meters/1' }]);
    send('/meters', [{ type: 's', value: '/meters/4' }]);
  }
  send('/-stat/rta/source', [{ type: 'i', value: src }]);
  await sleep(200);
  rtaFrames = [];
  await sleep(350);
  const frames = rtaFrames.slice();
  const meters = (lastMeters1 ?? []).map(Math.round);
  if (!frames.length) { results.push(`${src}: nessun dato`); continue; }
  const avg = frames[0].map((_, i) => frames.reduce((s, f) => s + f[i], 0) / frames.length);
  const total = powerSum(avg);
  const peakBin = avg.indexOf(Math.max(...avg));
  results.push(`${src}: totale ${total.toFixed(1)} dB, max banda ${peakBin} (${Math.round(avg[peakBin])} dB), frame ${frames.length} | meter1 ${meters.join(' ')}`);
}
if (original !== undefined) send('/-stat/rta/source', [{ type: 'i', value: original }]);
await sleep(300);
send('/-stat/rta/source');
await sleep(300);
results.forEach(r => log(r));
log(`Sorgente RTA ripristinata: ${fmt('/-stat/rta/source')} (originale ${original})`);
save();
process.exit(0);
