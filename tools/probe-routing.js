// Diagnostica 6: routing delle uscite (sorgente e punto di prelievo). SOLA LETTURA: non cambia nulla.
// Uso: node tools/probe-routing.js [--ip=192.168.1.9] [--port=10024] [--out=rapporto.txt]

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

log('== DIAGNOSTICA 6 (routing, sola lettura) ==', new Date().toISOString());
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

const query = async list => {
  for (let i = 0; i < list.length; i += 16) {
    for (const a of list.slice(i, i + 16)) send(a);
    await sleep(30);
  }
  await sleep(1500);
};
const fmt = a => (replies.has(a) ? replies.get(a).map(x => `${x.type}:${typeof x.value === 'number' ? +x.value.toFixed(4) : JSON.stringify(x.value)}`).join(' ') : '--');
const outs = [['aux', 6], ['usb', 18], ['p16', 16], ['main', 2]];
const info = outs.flatMap(([id, n]) => Array.from({ length: n }, (_, i) => [`/routing/${id}/${pad(i + 1)}/src`, `/routing/${id}/${pad(i + 1)}/pos`]).flat());
info.push('/routing/usb/01', '/routing/aux/01', '/routing/p16/01', '/config/routing', '/-prefs/usbifc', '/rtn/aux/config/rtnsrc', '/rtn/aux/preamp/rtnsw');
await query(info);
for (let round = 0; round < 4; round++) await query(info.filter(x => !replies.has(x)));
log('\n== ROUTING (sola lettura) ==');
for (const a of info) if (replies.has(a)) log(a, fmt(a));
log('Senza risposta:', info.filter(a => !replies.has(a)).join(' ') || 'nessuno');
save();
process.exit(0);
