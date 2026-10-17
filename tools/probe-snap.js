// Diagnostica 3: verifica i comandi degli snapshot usando SOLO uno slot vuoto (il 64).
// Passi: salva il mix attuale nello slot 64, gli dà un nome, lo ricarica (è identico al mix
// attuale, quindi l'audio non cambia), poi lo elimina. Se lo slot 64 non è vuoto, si ferma.
// Uso: node tools/probe-snap.js [--ip=192.168.1.9] [--out=rapporto.txt]

import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import { encode, decode } from '../server/osc.js';
import { SNAPSHOTS } from '../public/js/model.js';

const PORT = 10024;
const SLOT = 64;
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const outFile = arg('out');
let mixerIp = arg('ip') ?? null;
const lines = [];
const log = (...p) => { const l = p.join(' '); lines.push(l); console.log(l); };
const save = () => { if (outFile) { fs.writeFileSync(outFile, `${lines.join('\n')}\n`); console.log(`\nRapporto salvato in: ${outFile}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const sock = dgram.createSocket('udp4');
const replies = new Map();
const found = new Map();
sock.on('message', (buf, rinfo) => {
  let msgs;
  try { msgs = decode(buf); } catch { return; }
  for (const m of msgs) {
    if (m.address === '/xinfo') found.set(rinfo.address, m.args.map(a => a.value));
    replies.set(m.address, m.args.map(a => a.value));
  }
});
await new Promise(r => sock.bind(0, r));
sock.setBroadcast(true);
const send = (address, args = [], ip = mixerIp) => sock.send(encode(address, args), PORT, ip, () => {});

/** Legge un indirizzo (con ripetizioni, il Wi-Fi può perdere pacchetti). */
async function read(address) {
  replies.delete(address);
  for (let i = 0; i < 5 && !replies.has(address); i++) {
    send(address);
    await sleep(250);
  }
  return replies.get(address)?.[0];
}

log('== DIAGNOSTICA 3 (snapshot) ==', new Date().toISOString());
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

const nameAddr = SNAPSHOTS.name(SLOT);
const before = { name: await read(nameAddr), index: await read(SNAPSHOTS.index), current: await read(SNAPSHOTS.current) };
log('Prima:', JSON.stringify(before));
if (before.name === undefined) { log('Il mixer non risponde: interrotto.'); save(); process.exit(1); }
if (before.name !== '') { log(`Lo slot ${SLOT} non è vuoto ("${before.name}"): interrotto, nessuna modifica.`); save(); process.exit(1); }

log(`\n1. Salvataggio nello slot ${SLOT} (${SNAPSHOTS.save} ,i ${SLOT})`);
send(SNAPSHOTS.save, [{ type: 'i', value: SLOT }]);
await sleep(1500);
log('   nome dopo il salvataggio:', JSON.stringify(await read(nameAddr)), '| indice:', await read(SNAPSHOTS.index));

log('\n2. Nome dello snapshot');
send(nameAddr, [{ type: 's', value: 'PROVA APP' }]);
await sleep(500);
log('   nome:', JSON.stringify(await read(nameAddr)));

log(`\n3. Caricamento dello slot ${SLOT} (identico al mix attuale) (${SNAPSHOTS.load} ,i ${SLOT})`);
send(SNAPSHOTS.load, [{ type: 'i', value: SLOT }]);
await sleep(2000);
log('   indice:', await read(SNAPSHOTS.index), '| nome corrente:', JSON.stringify(await read(SNAPSHOTS.current)));

log(`\n4. Eliminazione dello slot ${SLOT} (${SNAPSHOTS.delete} ,i ${SLOT})`);
send(SNAPSHOTS.delete, [{ type: 'i', value: SLOT }]);
await sleep(1000);
let after = await read(nameAddr);
log('   nome dopo l\'eliminazione:', JSON.stringify(after));
if (after) {
  // il comando di eliminazione non ha funzionato: almeno si toglie il nome di prova
  send(nameAddr, [{ type: 's', value: '' }]);
  await sleep(500);
  after = await read(nameAddr);
  log('   nome azzerato a mano:', JSON.stringify(after));
}
log('\nDopo:', JSON.stringify({ name: after, index: await read(SNAPSHOTS.index), current: await read(SNAPSHOTS.current) }));
save();
process.exit(0);
