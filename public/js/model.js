// Struttura del mixer X Air (XR18): canali, ritorni, bus e indirizzi OSC.

const pad2 = n => String(n).padStart(2, '0');

// Colori delle scribble strip X Air (0-7 normali, 8-15 invertiti).
const BASE_COLORS = [
  ['Spento', '#3a3d44'],
  ['Rosso', '#ef4444'],
  ['Verde', '#22c55e'],
  ['Giallo', '#eab308'],
  ['Blu', '#3b82f6'],
  ['Magenta', '#d946ef'],
  ['Ciano', '#06b6d4'],
  ['Bianco', '#e5e7eb'],
];
export const COLORS = [
  ...BASE_COLORS.map(([name, hex]) => ({ name, hex, inverted: false })),
  ...BASE_COLORS.map(([name, hex]) => ({ name: `${name} inv.`, hex, inverted: true })),
];

/**
 * Indici nel blob /meters/1 (40 valori):
 * 0-15 canali, 16-17 aux L/R, 18-25 ritorni FX 1-4 L/R, 26-31 bus 1-6, 32-35 mandate FX 1-4,
 * 36-37 main L/R, 38-39 monitor L/R.
 *
 * Proprietà di una strip: sends = numero di mandate (1-6 bus, 7-10 effetti), groups = DCA/mute group,
 * lrAssign = assegnabile al Main LR, insert = insert FX, fx = slot effetto collegato,
 * source = sorgente selezionabile (analogica o ritorno USB), automix = canale assegnabile all'automix,
 * linkMeter = meter del canale/bus pari, mostrato quando la coppia è in link stereo.
 */
export function buildStrips() {
  const strips = [];
  const add = strip => strips.push({
    fader: `${strip.base}/mix/fader`,
    on: `${strip.base}/mix/on`,
    meters: [],
    ...strip,
  });

  for (let i = 1; i <= 16; i++) {
    add({ id: `ch${i}`, group: 'input', base: `/ch/${pad2(i)}`, label: `Ch ${i}`, solo: i, meters: [i - 1], pan: true,
      headamp: i, preamp: true, source: 'ch', automix: true, gate: true, dyn: true, eqBands: 4, insert: true, sends: 10, groups: true, lrAssign: true,
      linkMeter: i % 2 ? i : undefined });
  }
  add({ id: 'aux', group: 'input', base: '/rtn/aux', label: 'Aux/USB', solo: 17, meters: [16, 17], pan: true, source: 'aux',
    sends: 6, groups: true, lrAssign: true, eqBands: 4 });
  for (let i = 1; i <= 4; i++) {
    const m = 18 + (i - 1) * 2;
    add({ id: `rtn${i}`, group: 'input', base: `/rtn/${i}`, label: `FX ${i}`, solo: 17 + i, meters: [m, m + 1], pan: true,
      sends: 6, groups: true, lrAssign: true, fx: i, eqBands: 4 });
  }
  for (let i = 1; i <= 6; i++) {
    add({ id: `bus${i}`, group: 'bus', base: `/bus/${i}`, label: `Bus ${i}`, solo: 21 + i, meters: [25 + i], pan: true,
      dyn: true, eqBands: 6, groups: true, linkMeter: i % 2 ? 26 + i : undefined });
  }
  for (let i = 1; i <= 4; i++) {
    add({ id: `fxsend${i}`, group: 'bus', base: `/fxsend/${i}`, label: `FX Send ${i}`, solo: 27 + i, meters: [31 + i], pan: false,
      groups: true, fx: i });
  }
  for (let i = 1; i <= 4; i++) {
    add({ id: `dca${i}`, group: 'dca', base: `/dca/${i}`, label: `DCA ${i}`, solo: null, pan: false,
      fader: `/dca/${i}/fader`, on: `/dca/${i}/on` });
  }
  add({ id: 'lr', group: 'main', base: '/lr', label: 'Main LR', solo: null, meters: [36, 37], pan: true,
    dyn: true, eqBands: 6 });
  return strips;
}

/** Interruttori dei 4 mute group. */
export const MUTE_GROUPS = [1, 2, 3, 4].map(i => `/config/mute/${i}`);

export const soloAddress = strip => `/-stat/solosw/${pad2(strip.solo)}`;

export function stripAddresses(strip) {
  const a = [`${strip.base}/config/name`, `${strip.base}/config/color`, strip.fader, strip.on];
  if (strip.pan) a.push(`${strip.base}/mix/pan`);
  if (strip.solo) a.push(soloAddress(strip));
  return a;
}

/**
 * RTA del mixer: /meters/4 restituisce le 100 bande (verificato su XR18V2 fw 1.25) dello spettro della
 * sorgente scelta con /-stat/rta/source. Numerazione = ordine dei solo: 0-15 canali e 16 aux verificati
 * (17 non è l'aux R, quindi non segue l'ordine dei meter); 17-20 ritorni FX, 21-26 bus, 27-30 mandate FX,
 * 31 main LR ancora da confermare con segnale su bus e main.
 */
export const RTA_METERS = '/meters/4';
export const RTA_SOURCE = '/-stat/rta/source';
export const rtaSource = strip => (strip.id === 'lr' ? 31 : strip.solo ? strip.solo - 1 : null);

// --- snapshot, impostazioni, patch ------------------------------------------------------------

/**
 * Snapshot salvati nel mixer (64 posizioni). Nomi, indice e nome corrente verificati su XR18V2;
 * verificati anche load/save/delete con un intero (tools/probe-snap.js). Il salvataggio dà allo slot il nome
 * della scena corrente; il nome si cambia scrivendo /-snap/NN/name.
 */
export const SNAPSHOTS = {
  count: 64,
  name: n => `/-snap/${pad2(n)}/name`,
  index: '/-snap/index',
  current: '/-snap/name',
  load: '/-snap/load',
  save: '/-snap/save',
  delete: '/-snap/delete',
};

/** Comando di inizializzazione del mixer (da verificare: se il mixer non lo conosce, lo ignora). */
export const INIT_COMMAND = '/-action/initall';

/** Impostazioni generali (indirizzi verificati su XR18V2). */
export const SETTINGS = {
  soloLevel: '/config/solo/level',
  soloMono: '/config/solo/mono',
  linkEq: '/config/linkcfg/eq',
  linkDyn: '/config/linkcfg/dyn',
  linkFader: '/config/linkcfg/fdrmute',
};

/**
 * Patch delle uscite: sorgente di Aux out 1-6, USB 1-18 e Ultranet 1-16 (/routing/.../src).
 * La numerazione delle sorgenti segue l'ordine dei meter: verificata per canali (USB/Ultranet 1:1)
 * e bus (Aux out 1-6 = sorgenti 26-31); le voci da 36 in poi sono da verificare.
 */
export const ROUTING = [
  { id: 'aux', label: 'Aux out', count: 6 },
  { id: 'usb', label: 'USB', count: 18 },
  { id: 'p16', label: 'Ultranet', count: 16 },
];
export const routingAddress = (id, n) => `/routing/${id}/${pad2(n)}/src`;
export const ROUTING_SOURCES = [
  ...Array.from({ length: 16 }, (_, i) => `Ch ${i + 1}`),
  'Aux L', 'Aux R',
  ...[1, 2, 3, 4].flatMap(n => [`FX ${n} L`, `FX ${n} R`]),
  ...Array.from({ length: 6 }, (_, i) => `Bus ${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `FX Send ${i + 1}`),
  'Main L (?)', 'Main R (?)', 'Monitor L (?)', 'Monitor R (?)',
];

/**
 * Automix (ducking automatico dei microfoni parlati): ogni canale 1-16 va nel gruppo X o Y con un peso.
 * Il mixer risponde a /config/amixenable con due interi (X, Y): li salviamo come .../X e .../Y.
 * Lettura e scrittura dei sotto-indirizzi verificate su XR18V2 (tools/probe-src.js).
 */
export const AUTOMIX = {
  node: '/config/amixenable',
  enable: { X: '/config/amixenable/X', Y: '/config/amixenable/Y' },
};
/** Messaggi del mixer con più valori, divisi in sotto-indirizzi. */
export const MULTI_VALUE = { [AUTOMIX.node]: ['X', 'Y'] };

export function settingsAddresses() {
  return [
    ...Object.values(SETTINGS),
    AUTOMIX.node,
    SNAPSHOTS.index,
    SNAPSHOTS.current,
    ...ROUTING.flatMap(r => Array.from({ length: r.count }, (_, i) => routingAddress(r.id, i + 1))),
  ];
}
