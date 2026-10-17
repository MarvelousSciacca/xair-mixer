// Diagnostica di sola lettura: trova il mixer, controlla quali indirizzi OSC rispondono
// (tutti quelli usati dall'app più alcuni di prova) e registra i gruppi di meter.
// Non modifica nessun parametro del mixer.
// Uso: node tools/probe.js [--ip=192.168.1.1] [--out=percorso/rapporto.txt]

import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import { encode, decode } from '../server/osc.js';
import { buildStrips, stripAddresses, MUTE_GROUPS } from '../public/js/model.js';
import { stripParams } from '../public/js/params.js';
import { fxAddresses } from '../public/js/fx.js';

const PORT = 10024;
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const outFile = arg('out');
let mixerIp = arg('ip') ?? null;

const lines = [];
const log = (...parts) => {
  const line = parts.join(' ');
  lines.push(line);
  console.log(line);
};
const save = () => {
  if (!outFile) return;
  fs.writeFileSync(outFile, `${lines.join('\n')}\n`);
  console.log(`\nRapporto salvato in: ${outFile}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');

const sock = dgram.createSocket('udp4');
const replies = new Map();
const meterPackets = new Map();
const found = new Map();

sock.on('message', (buf, rinfo) => {
  let msgs;
  try { msgs = decode(buf); } catch { return; }
  for (const m of msgs) {
    if (m.address === '/xinfo') found.set(rinfo.address, m.args.map(a => a.value));
    if (m.address.startsWith('/meters/')) {
      const b = m.args[0]?.value;
      if (b && !meterPackets.has(m.address)) meterPackets.set(m.address, Buffer.from(b));
      continue;
    }
    if (!replies.has(m.address)) replies.set(m.address, m.args);
  }
});
await new Promise(r => sock.bind(0, r));
sock.setBroadcast(true);
const send = (address, args = [], ip = mixerIp) => sock.send(encode(address, args), PORT, ip, () => {});

log('== DIAGNOSTICA X AIR ==', new Date().toISOString());
log('Interfacce di rete del Mac:');
const targets = new Set(['255.255.255.255', '192.168.1.1']); // 192.168.1.1 = IP del mixer in modalità access point
for (const [name, list] of Object.entries(os.networkInterfaces())) {
  for (const ni of list ?? []) {
    if (ni.family !== 'IPv4' || ni.internal) continue;
    log(`  ${name} ${ni.address}/${ni.netmask}`);
    const ip = ni.address.split('.').map(Number), mask = ni.netmask.split('.').map(Number);
    targets.add(ip.map((b, i) => b | (~mask[i] & 255)).join('.'));
  }
}
if (mixerIp) targets.add(mixerIp);

// 1. ricerca (tre tentativi)
for (let attempt = 0; attempt < 3 && !found.size; attempt++) {
  for (const t of targets) send('/xinfo', [], t);
  await sleep(1500);
}
log('\n== MIXER TROVATI ==');
for (const [ip, info] of found) log(ip, info.join(' | '));
mixerIp ??= [...found.keys()].find(ip => ip !== '127.0.0.1');
if (!mixerIp) {
  log('Nessun mixer trovato. Controlla che il Mac sia sulla rete del mixer.');
  save();
  process.exit(1);
}
log('Uso', mixerIp);

// 2. indirizzi usati dall'app + indirizzi di prova
const strips = buildStrips();
const appAddresses = [
  ...strips.flatMap(stripAddresses),
  ...MUTE_GROUPS,
  ...strips.flatMap(s => stripParams(s).map(p => p.address)),
  ...fxAddresses(),
  ...[1, 3, 5, 7, 9, 11, 13, 15].map(i => `/config/chlink/${i}-${i + 1}`),
  ...[1, 3, 5].map(i => `/config/buslink/${i}-${i + 1}`),
  '/-prefs/rta/source',
];
const extra = [
  '/status', '/ch/01/config/insrc', '/ch/01/config/rtnsrc', '/ch/01/mix/st', '/ch/01/mix/mono', '/ch/01/mix/mlevel',
  '/ch/01/mix/01/pan', '/ch/01/mix/01/on', '/ch/01/mix/01/grpon', '/ch/01/mix/02/pan', '/ch/01/mix/11/level',
  '/ch/01/insert/sel', '/ch/01/insert/pos', '/ch/01/preamp/hpslope', '/ch/01/preamp/rtnsw', '/ch/01/preamp/trim',
  '/ch/01/gate/keysrc', '/ch/01/dyn/keysrc', '/ch/01/dyn/pos', '/ch/01/eq/5/f', '/ch/01/automix/group', '/ch/01/automix/weight',
  '/headamp/17/gain', '/headamp/17/phantom', '/headamp/18/gain',
  '/rtn/aux/mix/07/level', '/rtn/aux/eq/on', '/rtn/aux/eq/1/f', '/rtn/aux/preamp/gain', '/rtn/aux/preamp/rtnsw', '/rtn/aux/config/rtnsrc',
  '/rtn/1/mix/07/level', '/rtn/1/eq/on', '/rtn/1/eq/1/f', '/rtn/1/preamp/gain',
  '/bus/1/eq/mode', '/bus/1/eq/7/f', '/bus/1/insert/on', '/bus/1/insert/fxslot', '/bus/1/dyn/keysrc', '/bus/1/config/insrc',
  '/fxsend/1/mix/pan', '/fxsend/1/eq/on', '/lr/eq/mode', '/lr/insert/on', '/lr/insert/fxslot',
  '/dca/5/fader', '/config/linkcfg/hadly', '/config/linkcfg/eq', '/config/linkcfg/dyn', '/config/linkcfg/fdrmute',
  '/config/solo/level', '/config/solo/source', '/config/solo/mono', '/config/amixenable', '/config/amixlock',
  '/fx/1/insert', '/fx/1/source/l', '/fx/1/source/r', '/fx/1/par/65',
  '/-stat/solosw/40', '/-stat/selidx', '/-stat/solo', '/-stat/sendsonfader', '/-stat/bussendbank', '/-stat/rta/source',
  '/-prefs/rta/pos', '/-prefs/rta/mode', '/-prefs/rta/det', '/-prefs/rta/decay', '/-prefs/rta/peakhold', '/-prefs/rta/gain', '/-prefs/rta/autogain',
  '/routing/main/01', '/routing/main/02', '/routing/aux/01', '/routing/aux/06', '/routing/usb/01', '/routing/usb/18', '/routing/p16/01',
  '/routing/main/01/src', '/routing/aux/01/src', '/routing/usb/01/src', '/routing/p16/01/src', '/routing/ain/01',
  '/config/routing/usb', '/config/routing/ain', '/config/routing/main', '/config/routing/aux', '/config/routing/p16',
  '/-snap/name', '/-snap/index', '/-snap/01/name', '/-snap/64/name', '/-action/setscene', '/-show/showfile/scene/001/name',
  '/xinfo',
];
const all = [...new Set([...appAddresses, ...extra])];
log(`\nInterrogo ${all.length} indirizzi (${appAddresses.length} usati dall'app)...`);
for (let i = 0; i < all.length; i += 16) {
  for (const a of all.slice(i, i + 16)) send(a);
  await sleep(30);
}
await sleep(2500);
// seconda passata per quelli senza risposta (UDP può perdere pacchetti)
const retry = all.filter(a => !replies.has(a));
for (let i = 0; i < retry.length; i += 8) {
  for (const a of retry.slice(i, i + 8)) send(a);
  await sleep(40);
}
await sleep(2000);

const fmt = args => args.map(a => (a.type === 'b' ? `b:blob(${a.value.length})`
  : `${a.type}:${typeof a.value === 'number' ? +a.value.toFixed(4) : JSON.stringify(a.value)}`)).join(' ');

const appMissing = appAddresses.filter(a => !replies.has(a));
log(`\n== INDIRIZZI DELL'APP: ${appAddresses.length - appMissing.length} rispondono, ${appMissing.length} no ==`);
// raggruppa i mancanti per schema (numeri sostituiti con #)
const groups = new Map();
for (const a of appMissing) {
  const key = a.replace(/\d+/g, '#');
  groups.set(key, [...(groups.get(key) ?? []), a]);
}
for (const [key, list] of groups) log(`  MANCA ${key}  (${list.length}×, es. ${list[0]})`);

log('\n== TIPI E VALORI (canale 1, bus 1, main, fx 1, prove) ==');
const sample = all.filter(a => /^\/(ch\/01|bus\/1|lr|fx\/1|dca\/1|config|rtn\/(aux|1)|fxsend\/1|headamp\/(01|17|18)|-|routing|xinfo|status)/.test(a));
for (const a of sample) log(replies.has(a) ? 'OK  ' : '--  ', a, replies.has(a) ? fmt(replies.get(a)) : '');

log('\n== EFFETTI CARICATI ==');
for (let i = 1; i <= 4; i++) {
  const params = Array.from({ length: 16 }, (_, p) => replies.get(`/fx/${i}/par/${pad(p + 1)}`)?.[0]);
  log(`fx/${i}/type`, fmt(replies.get(`/fx/${i}/type`) ?? []), '| par 1-16:', params.map(x => (x ? `${x.type}:${+Number(x.value).toFixed(3)}` : '-')).join(' '));
}

// 3. meter (solo richiesta di invio dati, nessun parametro cambiato)
log('\n== METER ==');
for (let g = 0; g <= 16; g++) {
  const path = `/meters/${g}`;
  send('/meters', [{ type: 's', value: path }]);
  await sleep(400);
  const b = meterPackets.get(path);
  if (!b) {
    log(path, 'nessun dato');
    continue;
  }
  const shorts = (b.length - 4) >> 1;
  const vals = Array.from({ length: shorts }, (_, i) => Math.round(b.readInt16LE(4 + i * 2) / 256));
  log(path, `byte=${b.length} header=${b.readInt32LE(0)} int16=${shorts}`);
  log('   ', vals.join(' '));
}

save();
process.exit(0);
