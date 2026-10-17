// Simulatore di mixer X Air (XR18): risponde agli stessi comandi OSC sulla porta 10024 di 127.0.0.1.
// Serve per sviluppare e provare l'app senza il mixer collegato.

import dgram from 'node:dgram';
import { encode, decode } from './osc.js';
import { buildStrips, rtaSource, RTA_METERS, RTA_SOURCE, SNAPSHOTS, INIT_COMMAND, SETTINGS, ROUTING, routingAddress, MULTI_VALUE } from '../public/js/model.js';
import { RTA_BINS, binFreq, freqBin, stripFilters, responseDb } from '../public/js/dsp.js';
import { SPEC, stripParams, oscType, defaultValue, toNorm } from '../public/js/params.js';
import { FX_SLOTS, FX_PARAM_COUNT, SIM_FX_TYPES, fxParams, fxTypeAddress, fxParamAddress } from '../public/js/fx.js';

const NAME = 'XR18-SIM';
const MODEL = 'XR18';
const VERSION = '1.22';
const METER_COUNT = 40;

const pad2 = n => String(n).padStart(2, '0');

function faderToDb(f) {
  if (f <= 0) return -Infinity;
  if (f >= 0.5) return f * 40 - 30;
  if (f >= 0.25) return f * 80 - 50;
  if (f >= 0.0625) return f * 160 - 70;
  return f * 480 - 90;
}

// Parametri iniziali di un effetto. Come il mixer reale, quelli non usati valgono NaN.
function fxDefaults(typeIndex) {
  const { mapped, params } = fxParams(typeIndex);
  return Array.from({ length: FX_PARAM_COUNT }, (_, p) => {
    if (mapped) return params[p] ? { type: oscType(params[p]), value: defaultValue(params[p]) } : { type: 'f', value: NaN };
    return p < 12 ? { type: 'f', value: 0.5 } : { type: 'f', value: NaN };
  });
}

function dbToFader(db) {
  if (db <= -90) return 0;
  if (db >= -10) return Math.min(1, (db + 30) / 40);
  if (db >= -30) return (db + 50) / 80;
  if (db >= -60) return (db + 70) / 160;
  return (db + 90) / 480;
}

function defaultState() {
  const state = new Map();
  const put = (address, type, value) => state.set(address, { type, value });
  const strip = (base, name, color, fader, pan = true) => {
    put(`${base}/config/name`, 's', name);
    put(`${base}/config/color`, 'i', color);
    put(`${base}/mix/fader`, 'f', fader);
    put(`${base}/mix/on`, 'i', 1);
    if (pan) put(`${base}/mix/pan`, 'f', 0.5);
  };

  const names = ['Kick', 'Snare', 'Hi-Hat', 'Tom 1', 'Tom 2', 'OH L', 'OH R', 'Basso',
    'Chit 1', 'Chit 2', 'Keys L', 'Keys R', 'Voce 1', 'Voce 2', 'Voce 3', 'Cori'];
  const colors = [1, 1, 1, 1, 1, 3, 3, 5, 2, 2, 6, 6, 4, 4, 4, 7];
  names.forEach((name, i) => strip(`/ch/${pad2(i + 1)}`, name, colors[i], 0.55 + (i % 4) * 0.05));
  strip('/rtn/aux', 'USB', 7, 0.75);
  ['Reverb', 'Plate', 'Delay', 'Chorus'].forEach((name, i) => strip(`/rtn/${i + 1}`, name, 6, 0.6));
  for (let i = 1; i <= 6; i++) strip(`/bus/${i}`, `Monitor ${i}`, 5, 0.75);
  for (let i = 1; i <= 4; i++) strip(`/fxsend/${i}`, `FX ${i}`, 6, 0.75, false);
  strip('/lr', 'Main', 7, 0.75);
  for (let i = 1; i <= 32; i++) put(`/-stat/solosw/${pad2(i)}`, 'i', 0);
  put(RTA_SOURCE, 'i', 31);
  for (let i = 1; i < 16; i += 2) put(`/config/chlink/${i}-${i + 1}`, 'i', 0);
  for (let i = 1; i < 6; i += 2) put(`/config/buslink/${i}-${i + 1}`, 'i', 0);

  // Preamp, gate, EQ e compressore con i valori iniziali definiti nell'interfaccia.
  for (const strip of buildStrips()) {
    for (const { address, spec } of stripParams(strip)) put(address, oscType(spec), defaultValue(spec));
  }
  // Qualche impostazione di esempio, per avere curve e indicatori da guardare.
  const real = (address, spec, x) => put(address, 'f', toNorm(spec, x));
  for (let i = 1; i <= 16; i++) real(`/headamp/${pad2(i)}/gain`, SPEC.gain, 20 + (i % 4) * 6);
  put('/ch/01/gate/on', 'i', 1);
  put('/ch/01/eq/on', 'i', 1);
  real('/ch/01/eq/1/g', SPEC.eqG, 5);
  real('/ch/01/eq/2/g', SPEC.eqG, -6);
  real('/ch/01/eq/3/f', SPEC.eqF(2000), 3500);
  real('/ch/01/eq/3/g', SPEC.eqG, 4);
  for (const ch of ['13', '14', '15']) {
    put(`/ch/${ch}/dyn/on`, 'i', 1);
    put(`/ch/${ch}/preamp/hpon`, 'i', 1);
    real(`/ch/${ch}/preamp/hpf`, SPEC.hpf, 120);
    real(`/ch/${ch}/dyn/thr`, SPEC.dyn.thr, -30);
  }
  put('/headamp/13/phantom', 'i', 1);

  // DCA e mute group
  ['Batteria', 'Voci', 'Strumenti', 'Effetti'].forEach((name, i) => {
    put(`/dca/${i + 1}/config/name`, 's', name);
    put(`/dca/${i + 1}/config/color`, 'i', [1, 4, 2, 6][i]);
    put(`/dca/${i + 1}/fader`, 'f', 0.75);
    put(`/dca/${i + 1}/on`, 'i', 1);
    put(`/config/mute/${i + 1}`, 'i', 0);
  });
  const assign = (chs, kind, bit) => chs.forEach(c => put(`/ch/${pad2(c)}/grp/${kind}`, 'i', 1 << bit));
  assign([1, 2, 3, 4, 5, 6, 7], 'dca', 0);
  assign([13, 14, 15, 16], 'dca', 1);
  assign([8, 9, 10, 11, 12], 'dca', 2);
  assign([1, 2, 3, 4, 5, 6, 7], 'mute', 0);

  // Mandate di esempio: voci nei monitor 1-2, strumenti nel 3, voci e rullante al riverbero.
  const send = (ch, n, db) => put(`/ch/${pad2(ch)}/mix/${pad2(n)}/level`, 'f', dbToFader(db));
  for (const ch of [13, 14, 15]) { send(ch, 1, 0); send(ch, 2, -5); send(ch, 7, -10); }
  for (const ch of [8, 9, 10, 11, 12]) send(ch, 3, -3);
  send(2, 7, -15);
  send(9, 9, -12);

  // Impostazioni, patch, snapshot
  for (const [node, parts] of Object.entries(MULTI_VALUE)) for (const k of parts) put(`${node}/${k}`, 'i', 0);
  put(SETTINGS.soloLevel, 'f', 0.75);
  put(SETTINGS.soloMono, 'i', 0);
  for (const k of ['linkEq', 'linkDyn', 'linkFader']) put(SETTINGS[k], 'i', 1);
  for (const r of ROUTING) {
    for (let n = 1; n <= r.count; n++) put(routingAddress(r.id, n), 'i', r.id === 'aux' ? 25 + n : n - 1);
  }
  for (let n = 1; n <= SNAPSHOTS.count; n++) put(SNAPSHOTS.name(n), 's', '');
  put(SNAPSHOTS.index, 'i', 1);
  put(SNAPSHOTS.current, 's', 'Prova');

  // Effetti
  FX_SLOTS.forEach((slot, i) => {
    put(fxTypeAddress(slot), 'i', SIM_FX_TYPES[i]);
    fxDefaults(SIM_FX_TYPES[i]).forEach((v, p) => put(fxParamAddress(slot, p), v.type, v.value));
    put(`/fx/${slot}/insert`, 'i', 0);
  });
  return state;
}

export function startSimulator({ host = '127.0.0.1', port = 10024 } = {}) {
  const state = defaultState();
  // Snapshot: copie dello stato del mix (tutto tranne stato e snapshot stessi).
  const snaps = new Map();
  const mixOnly = () => new Map([...state].filter(([a]) => !a.startsWith('/-')));
  const saveSnap = (n, name) => {
    snaps.set(n, mixOnly());
    state.set(SNAPSHOTS.name(n), { type: 's', value: name });
  };
  saveSnap(1, 'Prova');
  saveSnap(2, 'Concerto');
  const strips = buildStrips();
  const clients = new Map(); // "ip:porta" -> { rinfo, remoteUntil, meters: Map(percorso -> scadenza) }
  const sock = dgram.createSocket('udp4');

  const sendTo = (rinfo, address, args) => sock.send(encode(address, args), rinfo.port, rinfo.address, () => {});
  const value = address => state.get(address)?.value;

  // Feedback simulato: un tono che cresce su un'uscita finché un notch (o il fader) non lo ferma.
  let fb = null;
  const FB_FREQS = [315, 500, 800, 1250, 2000, 2500, 3150, 4000];
  const startFeedback = out => {
    if (!strips.some(s => s.id === out)) return;
    const freq = FB_FREQS[Math.floor(Math.random() * FB_FREQS.length)] * (0.97 + Math.random() * 0.06);
    fb = { out, freq, level: -45 };
    console.log(`Simulatore: feedback su ${out} a ${Math.round(freq)} Hz`);
  };

  sock.on('message', (buf, rinfo) => {
    const key = `${rinfo.address}:${rinfo.port}`;
    let client = clients.get(key);
    if (!client) clients.set(key, (client = { rinfo, remoteUntil: 0, meters: new Map() }));

    let messages;
    try {
      messages = decode(buf);
    } catch {
      return;
    }
    for (const { address, args } of messages) {
      switch (address) {
        case '/xinfo':
          sendTo(rinfo, '/xinfo', [host, NAME, MODEL, VERSION].map(v => ({ type: 's', value: v })));
          continue;
        case '/status':
          sendTo(rinfo, '/status', ['active', host, NAME].map(v => ({ type: 's', value: v })));
          continue;
        case '/xremote':
          client.remoteUntil = Date.now() + 10_000;
          continue;
        case '/meters':
          if (args[0]?.type === 's') client.meters.set(args[0].value, Date.now() + 10_000);
          continue;
        case SNAPSHOTS.save: {
          const n = args[0]?.value;
          saveSnap(n, value(SNAPSHOTS.name(n)) || value(SNAPSHOTS.current) || `Snap ${n}`);
          continue;
        }
        case SNAPSHOTS.load: {
          const n = args[0]?.value;
          if (!snaps.has(n)) continue;
          for (const [a, v] of snaps.get(n)) state.set(a, { ...v });
          state.set(SNAPSHOTS.index, { type: 'i', value: n });
          state.set(SNAPSHOTS.current, { type: 's', value: value(SNAPSHOTS.name(n)) });
          console.log(`Simulatore: caricato snapshot ${n}`);
          continue;
        }
        case SNAPSHOTS.delete: {
          const n = args[0]?.value;
          snaps.delete(n);
          state.set(SNAPSHOTS.name(n), { type: 's', value: '' });
          continue;
        }
        case INIT_COMMAND: {
          // Inizializzazione: tutto il mix torna ai valori iniziali, gli snapshot restano.
          const fresh = defaultState();
          for (const [a, v] of fresh) if (!a.startsWith('/-snap/')) state.set(a, v);
          for (const [a] of state) if (/\/config\/name$/.test(a)) state.set(a, { type: 's', value: '' });
          console.log('Simulatore: mixer inizializzato');
          continue;
        }
        case '/-sim/feedback':
          startFeedback(args[0]?.value);
          continue;
      }

      // Nodi con più valori (es. /config/amixenable X Y): risposta con tutti i valori.
      if (MULTI_VALUE[address]) {
        const parts = MULTI_VALUE[address].map(k => `${address}/${k}`);
        if (args.length) args.forEach((a, i) => parts[i] && state.set(parts[i], { type: 'i', value: Math.round(a.value) }));
        else sendTo(rinfo, address, parts.map(p => state.get(p)));
        continue;
      }
      if (args.length === 0) {
        const current = state.get(address);
        if (current) sendTo(rinfo, address, [current]);
        continue;
      }

      // Scrittura di un parametro: mantiene il tipo già memorizzato e notifica gli altri client in /xremote.
      const type = state.get(address)?.type ?? args[0].type;
      const stored = { type, value: type === 'i' ? Math.round(args[0].value) : args[0].value };
      state.set(address, stored);
      // Cambio di effetto: come il mixer, carica i parametri predefiniti del nuovo tipo.
      const fxType = address.match(/^\/fx\/(\d)\/type$/);
      if (fxType) {
        fxDefaults(stored.value).forEach((v, p) => state.set(fxParamAddress(Number(fxType[1]), p), v));
      }
      const now = Date.now();
      for (const [k, c] of clients) if (k !== key && c.remoteUntil > now) sendTo(c.rinfo, address, [stored]);
    }
  });

  const meterBlob = values => {
    const blob = Buffer.alloc(4 + values.length * 2);
    blob.writeInt32LE(values.length, 0);
    values.forEach((db, i) => {
      const v = Math.max(-32768, Math.min(0, Math.round((Number.isFinite(db) ? db : -128) * 256)));
      blob.writeInt16LE(v, 4 + i * 2);
    });
    return [{ type: 'b', value: blob }];
  };
  const powerSum = (a, b) => 10 * Math.log10(10 ** (a / 10) + 10 ** (b / 10));

  // Spettro RTA di una strip: segnale "musicale" al suo livello, filtrato dal suo EQ, più l'eventuale feedback.
  const spectrum = (strip, levels) => {
    const level = Math.max(...strip.meters.map(i => levels[i]));
    const filters = stripFilters(strip, value);
    const center = fb?.out === strip.id ? freqBin(fb.freq) : null;
    const out = [];
    for (let i = 0; i < RTA_BINS; i++) {
      const f = binFreq(i);
      let db = level - 10 - 3.5 * Math.abs(Math.log2(f / 250)) + responseDb(filters, f) + Math.random() * 4 - 2;
      if (center !== null) db = powerSum(db, fb.level - 14 * (i - center) ** 2);
      out.push(Math.max(-128, Math.min(0, db)));
    }
    return out;
  };

  let rtaDisplay = null;

  // Meter finti: segnali che oscillano, con colpi periodici su cassa e rullante.
  const start = Date.now();
  setInterval(() => {
    const now = Date.now();
    const wants = path => [...clients.values()].filter(c => (c.meters.get(path) ?? 0) > now);
    const meterClients = wants('/meters/1');
    const rtaClients = wants(RTA_METERS);

    if (fb) {
      const s = strips.find(x => x.id === fb.out);
      const attenuation = responseDb(stripFilters(s, value), fb.freq);
      const open = value(`${s.base}/mix/on`) && (value(`${s.base}/mix/fader`) ?? 0) > 0.3 && attenuation > -5;
      fb.level = open ? Math.min(-3, fb.level + 0.5) : fb.level - 2;
      if (fb.level < -80) {
        console.log('Simulatore: feedback eliminato');
        fb = null;
      }
    }
    if (!meterClients.length && !rtaClients.length) return;

    const t = (now - start) / 1000;
    const levels = new Array(METER_COUNT).fill(-128);
    const input = i => {
      let db = -24 - (i % 5) * 2 + 6 * Math.sin(t * (0.6 + i * 0.17)) + Math.random() * 3;
      if (i === 0) db = (t * 2) % 1 < 0.12 ? -6 : -40;
      if (i === 1) db = (t * 2 + 0.5) % 1 < 0.1 ? -8 : -42;
      return db;
    };
    const db = address => faderToDb(value(address) ?? 0);
    const sum = list => 10 * Math.log10(list.reduce((acc, x) => acc + 10 ** (x / 10), 0) || 1e-13);
    // Guadagno di una strip dopo fader, DCA e mute group (-Infinity se spenta).
    const gain = (base, fader = `${base}/mix/fader`) => {
      if (!value(`${base}/mix/on`)) return -Infinity;
      const dca = value(`${base}/grp/dca`) ?? 0;
      const mute = value(`${base}/grp/mute`) ?? 0;
      let g = db(fader);
      for (let i = 0; i < 4; i++) {
        if (mute & (1 << i) && value(`/config/mute/${i + 1}`)) return -Infinity;
        if (dca & (1 << i)) {
          if (!value(`/dca/${i + 1}/on`)) return -Infinity;
          g += db(`/dca/${i + 1}/fader`);
        }
      }
      return g;
    };

    // Ingressi: canali 1-16 (sorgenti finte), aux, ritorni FX (alimentati dalle mandate effetti).
    const inputs = [];
    for (let i = 0; i < 16; i++) {
      levels[i] = input(i);
      inputs.push({ base: `/ch/${pad2(i + 1)}`, level: levels[i], sends: 10 });
    }
    levels[16] = levels[17] = input(16);
    inputs.push({ base: '/rtn/aux', level: levels[16], sends: 6 });
    const sendSum = (n, list) => sum(list.filter(x => n <= x.sends).map(x => {
      const send = `${x.base}/mix/${pad2(n)}`;
      const post = (value(`${send}/tap`) ?? 4) >= 4; // POST: dopo fader e DCA
      const g = gain(x.base);
      return g === -Infinity ? -Infinity : x.level + db(`${send}/level`) + (post ? g : 0);
    }));

    for (let i = 0; i < 4; i++) {
      const fxIn = sendSum(7 + i, inputs);
      const fxsendGain = gain(`/fxsend/${i + 1}`);
      levels[32 + i] = fxIn + fxsendGain;
      levels[18 + i * 2] = levels[19 + i * 2] = levels[32 + i] - 6; // ritorno dell'effetto
      inputs.push({ base: `/rtn/${i + 1}`, level: levels[18 + i * 2], sends: 6 });
    }
    for (let i = 0; i < 6; i++) levels[26 + i] = sendSum(i + 1, inputs) + gain(`/bus/${i + 1}`);
    const main = sum(inputs.filter(x => value(`${x.base}/mix/lr`) ?? 1).map(x => x.level + gain(x.base))) + gain('/lr');
    levels[36] = levels[38] = main;
    levels[37] = levels[39] = main - 0.5;
    for (let i = 0; i < levels.length; i++) if (!Number.isFinite(levels[i])) levels[i] = -128;
    const music = [...levels]; // livelli senza feedback: lo spettro "musicale" non sale col fischio
    if (fb) for (const i of strips.find(x => x.id === fb.out).meters) levels[i] = powerSum(levels[i], fb.level);

    if (meterClients.length) {
      const args = meterBlob(levels);
      for (const c of meterClients) sendTo(c.rinfo, '/meters/1', args);
    }
    if (rtaClients.length) {
      const source = value(RTA_SOURCE) ?? 31;
      const strip = strips.find(s => rtaSource(s) === source);
      if (strip) {
        // Come il mixer reale: lo spettro mostrato scende al massimo di ~1 dB per pacchetto (coda).
        const fresh = spectrum(strip, music);
        rtaDisplay = fresh.map((v, i) => Math.max(v, (rtaDisplay?.[i] ?? -128) - 1));
        const args = meterBlob(rtaDisplay);
        for (const c of rtaClients) sendTo(c.rinfo, RTA_METERS, args);
      }
    }
  }, 50);

  sock.bind(port, host, () => console.log(`Simulatore ${MODEL} in ascolto su ${host}:${port}`));
  return sock;
}
