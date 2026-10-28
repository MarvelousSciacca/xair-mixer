// Diagnostica 7: canali protetti durante il caricamento di uno snapshot, e impostazioni dell'RTA.
// Domanda: quando l'app carica uno snapshot e subito dopo rimette i valori dei canali protetti,
// il mixer applica per un istante il valore dello snapshot (un "salto" che si sentirebbe su un fader)?
// Per non toccare l'audio la prova usa un parametro che non si sente: il COLORE del canale 16.
// Usa solo lo slot 64, e solo se è vuoto; lo snapshot è il mix attuale, quindi ricaricarlo non cambia
// l'audio. Alla fine rimette il colore e cancella lo slot 64. Si ferma se un'altra app sta cambiando
// il mixer. Le impostazioni dell'RTA vengono solo lette.
// Uso: node tools/probe-protect.js [--ip=192.168.1.9] [--out=rapporto.txt]

import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import { encode, decode } from '../server/osc.js';
import { SNAPSHOTS } from '../public/js/model.js';

const PORT = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? 10024); // --port solo per provarla sul simulatore
const SLOT = 64;
const PROBE = '/ch/16/config/color';
const DELAYS = [0, 50, 200]; // ms tra il comando di caricamento e il ripristino del valore protetto
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
let watch = null; // { address, t0, events: [[ms, valore]] } mentre si osserva un parametro
let foreign = []; // cambi arrivati da altri durante il controllo iniziale
let checkingForeign = false;
sock.on('message', (buf, rinfo) => {
  let msgs;
  try { msgs = decode(buf); } catch { return; }
  for (const m of msgs) {
    if (m.address === '/xinfo') found.set(rinfo.address, m.args.map(a => a.value));
    replies.set(m.address, m.args.map(a => a.value));
    if (watch && m.address === watch.address) watch.events.push([Math.round(performance.now() - watch.t0), m.args[0]?.value]);
    if (checkingForeign && !m.address.startsWith('/meters') && m.address !== '/xinfo' && !m.address.startsWith('/-')) foreign.push(m.address);
  }
});
await new Promise(r => sock.bind(0, r));
sock.setBroadcast(true);
const send = (address, args = [], ip = mixerIp) => sock.send(encode(address, args), PORT, ip, () => {});

async function read(address) {
  replies.delete(address);
  for (let i = 0; i < 5 && !replies.has(address); i++) {
    send(address);
    await sleep(250);
  }
  return replies.get(address)?.[0];
}

const finish = code => { save(); sock.close(); process.exit(code); };

log('== DIAGNOSTICA 7 (canali protetti e snapshot, impostazioni RTA) ==', new Date().toISOString());
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
if (!mixerIp) { log('Nessun mixer trovato.'); finish(1); }
log('Mixer:', mixerIp, (found.get(mixerIp) ?? []).join(' | '));

// --- impostazioni RTA (sola lettura) -------------------------------------------------------------
log('\nA. Impostazioni RTA (sola lettura)');
for (const a of ['/-prefs/rta/pos', '/-prefs/rta/mode', '/-prefs/rta/det', '/-prefs/rta/decay', '/-prefs/rta/peakhold', '/-prefs/rta/gain', '/-stat/rta/source']) {
  const v = await read(a);
  log(`   ${a.padEnd(24)} ${v === undefined ? 'nessuna risposta' : JSON.stringify(v)}`);
}

// --- altre app collegate? --------------------------------------------------------------------------
log('\nB. Controllo che nessun altro stia cambiando il mixer (3 secondi)');
send('/xremote');
checkingForeign = true;
await sleep(3000);
checkingForeign = false;
if (foreign.length) {
  log(`   Cambi arrivati da altri dispositivi: ${[...new Set(foreign)].slice(0, 8).join(', ')}`);
  log('   Interrotto senza modifiche: chiudi X-AIR-Edit e AirDesk su telefoni e tablet, poi riprova.');
  finish(1);
}
log('   nessun cambio esterno');

// --- canali protetti ------------------------------------------------------------------------------
log('\nC. Snapshot e canale protetto (parametro di prova: colore del canale 16, non si sente)');
const nameAddr = SNAPSHOTS.name(SLOT);
const slotName = await read(nameAddr);
if (slotName === undefined) { log('   Il mixer non risponde: interrotto.'); finish(1); }
if (slotName !== '') { log(`   Lo slot ${SLOT} non è vuoto ("${slotName}"): interrotto, nessuna modifica.`); finish(1); }
const c0 = await read(PROBE);
if (!Number.isInteger(c0)) { log('   Colore del canale 16 non leggibile: interrotto.'); finish(1); }
const c1 = (c0 + 1) % 16;
log(`   colore attuale ${c0}, valore "protetto" di prova ${c1}`);

send(SNAPSHOTS.save, [{ type: 'i', value: SLOT }]);
await sleep(1500);
send(nameAddr, [{ type: 's', value: 'PROVA APP' }]);
await sleep(500);
log(`   mix attuale salvato nello slot ${SLOT}:`, JSON.stringify(await read(nameAddr)));

for (const delay of DELAYS) {
  send(PROBE, [{ type: 'i', value: c1 }]);
  await sleep(600);
  const before = await read(PROBE);
  send('/xremote');
  watch = { address: PROBE, t0: performance.now(), events: [] };
  send(SNAPSHOTS.load, [{ type: 'i', value: SLOT }]);
  if (delay) await sleep(delay);
  send(PROBE, [{ type: 'i', value: c1 }]); // come fa l'app per i canali protetti
  await sleep(2500);
  const events = watch.events;
  watch = null;
  const final = await read(PROBE);
  const wrong = events.filter(([, v]) => v === c0);
  log(`\n   ripristino dopo ${delay} ms: prima ${before}, finale ${final} (${final === c1 ? 'protetto' : 'NON protetto'})`);
  log(`   valori annunciati dal mixer: ${events.length ? events.map(([t, v]) => `${t} ms → ${v}`).join(', ') : 'nessuno'}`);
  log(`   valore dello snapshot visto per un istante: ${wrong.length ? `sì (${wrong.map(([t]) => `${t} ms`).join(', ')})` : 'no'}`);
}

// --- pulizia ----------------------------------------------------------------------------------
log('\nD. Pulizia');
send(PROBE, [{ type: 'i', value: c0 }]);
await sleep(500);
log(`   colore del canale 16 rimesso: ${await read(PROBE)} (era ${c0})`);
send(SNAPSHOTS.delete, [{ type: 'i', value: SLOT }]);
await sleep(1000);
let after = await read(nameAddr);
if (after) {
  send(nameAddr, [{ type: 's', value: '' }]);
  await sleep(500);
  after = await read(nameAddr);
}
log(`   slot ${SLOT} dopo la pulizia: ${JSON.stringify(after)}`);
finish(0);
