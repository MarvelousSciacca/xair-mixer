// Effetti dei 4 slot FX: i 61 tipi del mixer X Air, categorie, descrizioni e parametri
// (/fx/N/type, /fx/N/par/01..64).
//
// Verifiche fatte:
// - ordine dei tipi (indice OSC): confermato sul mixer dell'utente (Plate = 5, Delay + Chorus = 24,
//   Modulation Delay = 26 con 13 parametri, interi in 2a, 8a e 9a posizione, M/S Fair Compressor = 42);
// - nomi e codici: presi dall'elenco interno di X-AIR-Edit;
// - parametri di Hall, Vintage Room e Modulation Delay: confrontati con i preset di fabbrica di X-AIR-Edit.
// Per gli altri effetti nomi e ordine seguono X-AIR-Edit e la documentazione Behringer degli effetti
// X32/X Air; i range non verificati sono mostrati in percentuale (pct). L'interfaccia usa comunque il
// numero e il tipo (intero/decimale) di parametri dichiarati dal mixer.

const pad2 = n => String(n).padStart(2, '0');

const lin = (label, min, max, unit, def) => ({ kind: 'lin', label, min, max, unit, def });
const log = (label, min, max, unit, def) => ({ kind: 'log', label, min, max, unit, def });
const enm = (label, options, def = 0) => ({ kind: 'enum', label, options, def });
const pct = (label, def = 50) => lin(label, 0, 100, '%', def);
const sw = (label, def = 0) => enm(label, ['OFF', 'ON'], def);
const bip = (label, range = 100) => lin(label, -range, range, '', 0);
const db = (label, min, max, def = 0) => lin(label, min, max, 'dB', def);

// --- mattoncini comuni -----------------------------------------------------------------------------
const preDelay = lin('Pre delay', 0, 200, 'ms', 20);
const damping = log('Damping', 1000, 20000, 'Hz', 5000);
const diffusion = lin('Diffusione', 1, 30, '', 15);
const level = db('Livello', -12, 12);
const loCut = log('Lo cut', 10, 500, 'Hz', 50);
const hiCut = log('Hi cut', 200, 20000, 'Hz', 10000);
const bassMult = log('Bass mult', 0.5, 2, 'x', 1);
const spread = lin('Spread', 0, 50, '', 25);
const shape = lin('Shape', 0, 250, '', 120);
const spin = lin('Spin', 0, 100, '', 50);
const mix = pct('Mix', 50);
const speed = log('Velocità', 0.05, 4, 'Hz', 0.5);
const phase = lin('Fase', 0, 180, '°', 90);
const FACTORS = ['1/4', '1/3', '3/8', '1/2', '2/3', '3/4', '1', '1/4X', '1/3X', '3/8X', '1/2X', '2/3X', '3/4X', '1X'];
const DLY_FACTORS = ['1/4', '3/8', '1/2', '2/3', '1', '4/3', '3/2', '2', '3'];
const time = lin('Tempo', 1, 3000, 'ms', 300); // lineare: verificato sul Modulation Delay
const delayFeed = pct('Feedback', 30);
const GEQ_BANDS = ['20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160', '200', '250', '315', '400', '500', '630', '800',
  '1k', '1k25', '1k6', '2k', '2k5', '3k15', '4k', '5k', '6k3', '8k', '10k', '12k5', '16k', '20k'];
const geqBands = suffix => GEQ_BANDS.map(f => db(`${f}${suffix}`, -15, 15));
const dual = (fn) => [...fn('A'), ...fn('B')];

const reverb = (decayMin, decayMax, sizeMin, sizeMax, sizeUnit) => [
  preDelay, log('Decay', decayMin, decayMax, 's', 2), lin('Size', sizeMin, sizeMax, sizeUnit, (sizeMin + sizeMax) / 2),
  damping, diffusion, level, loCut, hiCut,
];

// --- tipi, nell'ordine degli indici OSC del mixer ----------------------------------------------------
// cat: riverberi, delay, modulazione, combinati, eq, dinamiche, colore
export const FX_TYPES = [
  { code: 'HALL', name: 'Hall Reverb', cat: 'riverberi', desc: 'Riverbero di sala da concerto, ampio e morbido.',
    params: [...reverb(0.2, 5, 2, 100, ''), bassMult, spread, shape, lin('Mod speed', 0, 100, '', 30)] },
  { code: 'AMBI', name: 'Ambience', cat: 'riverberi', desc: 'Ambienza corta: dà spazio senza coda evidente.',
    params: [preDelay, log('Decay', 0.2, 7.3, 's', 1), lin('Size', 2, 100, '', 50), damping, diffusion, level, loCut, hiCut, pct('Modulazione'), pct('Tail gain')] },
  { code: 'RPLT', name: 'Rich Plate Reverb', cat: 'riverberi', desc: 'Plate ricco e brillante, ottimo su voci e rullante.',
    params: [...reverb(0.3, 29, 4, 39, 'm'), log('Bass mult', 0.25, 4, 'x', 1), spread, pct('Attack'), spin,
      lin('Echo L', 0, 1200, 'ms', 0), lin('Echo R', 0, 1200, 'ms', 0), bip('Echo feed L'), bip('Echo feed R')] },
  { code: 'ROOM', name: 'Room Reverb', cat: 'riverberi', desc: 'Stanza naturale, dalla piccola alla grande.',
    params: [...reverb(0.3, 29, 4, 76, 'm'), bassMult, spread, shape, spin,
      lin('Echo L', 0, 1200, 'ms', 0), lin('Echo R', 0, 1200, 'ms', 0), bip('Echo feed L'), bip('Echo feed R')] },
  { code: 'CHAM', name: 'Chamber Reverb', cat: 'riverberi', desc: 'Camera d\'eco: denso e caldo.',
    params: [...reverb(0.3, 29, 4, 72, 'm'), bassMult, spread, shape, spin,
      lin('Rifl. L', 0, 500, 'ms', 0), lin('Rifl. R', 0, 500, 'ms', 0), pct('Livello rifl. L'), pct('Livello rifl. R')] },
  { code: 'PLAT', name: 'Plate Reverb', cat: 'riverberi', desc: 'Plate classico, liscio e definito.',
    params: [preDelay, log('Decay', 0.5, 10, 's', 2), lin('Size', 2, 100, '', 50), damping, diffusion, level, loCut, hiCut, bassMult,
      log('Crossover', 10, 500, 'Hz', 100), lin('Mod depth', 1, 50, '', 20), lin('Mod speed', 0, 100, '', 50)] },
  { code: 'VREV', name: 'Vintage Reverb', cat: 'riverberi', desc: 'Riverbero digitale anni \'80, colore vintage.',
    params: [lin('Pre delay', 0, 120, 'ms', 20), log('Decay', 0.4, 4.5, 's', 1.5), pct('Modulazione'), sw('Vintage', 1),
      enm('Posizione', ['FRONT', 'REAR']), level, log('Lo mult', 0.5, 2, 'x', 1), log('Hi mult', 0.25, 1, 'x', 0.7)] },
  { code: 'VRM', name: 'Vintage Room', cat: 'riverberi', desc: 'Stanza vintage con prime riflessioni regolabili.',
    params: [lin('Rev delay', 0, 120, 'ms', 20), log('Decay', 0.1, 20, 's', 1.94), lin('Size', 1, 30, '', 24), lin('Densità', 1, 30, '', 30),
      lin('Livello ER', 0, 190, '', 22), level, log('Lo mult', 0.1, 10, 'x', 1.1), log('Hi mult', 0.1, 10, 'x', 0.7),
      loCut, hiCut, lin('ER L', 0, 100, '', 28), lin('ER R', 0, 100, '', 34)] },
  { code: 'GATE', name: 'Gated Reverb', cat: 'riverberi', desc: 'Riverbero tagliato di netto, effetto batteria anni \'80.',
    params: [preDelay, lin('Decay', 140, 1000, 'ms', 300), lin('Attack', 0, 30, '', 10), lin('Densità', 1, 50, '', 25), pct('Spread'),
      loCut, log('Hi shv freq', 200, 20000, 'Hz', 5000), db('Hi shv gain', -30, 0), diffusion] },
  { code: 'RVRS', name: 'Reverse Reverb', cat: 'riverberi', desc: 'Riverbero al contrario che cresce verso il suono.',
    params: [preDelay, lin('Decay', 140, 1000, 'ms', 300), lin('Rise', 0, 50, '', 25), diffusion, pct('Spread'),
      loCut, log('Hi shv freq', 200, 20000, 'Hz', 5000), db('Hi shv gain', -30, 0)] },
  { code: 'DLY', name: 'Stereo Delay', cat: 'delay', desc: 'Delay stereo con fattori L/R e feedback filtrato.',
    params: [pct('Mix', 30), time, enm('Modo', ['ST', 'X', 'M']), enm('Fattore L', DLY_FACTORS, 4), enm('Fattore R', DLY_FACTORS, 4),
      lin('Offset L/R', -100, 100, 'ms', 0), loCut, hiCut, log('Feed lo cut', 10, 500, 'Hz', 50), lin('Feed L', 1, 100, '%', 30),
      lin('Feed R', 1, 100, '%', 30), log('Feed hi cut', 200, 20000, 'Hz', 8000)] },
  { code: '3TAP', name: '3-Tap Delay', cat: 'delay', desc: 'Delay a tre ripetizioni con guadagno e pan per ciascuna.',
    params: [time, pct('Gain T'), bip('Pan T'), delayFeed, enm('Fattore A', FACTORS, 6), pct('Gain A'), bip('Pan A'),
      enm('Fattore B', FACTORS, 6), pct('Gain B'), bip('Pan B'), sw('Mono'), sw('Dry')] },
  { code: '4TAP', name: 'Rhythm Delay', cat: 'delay', desc: 'Delay ritmico a quattro ripetizioni.',
    params: [time, pct('Gain'), delayFeed, enm('Fattore A', FACTORS, 6), pct('Gain A'), enm('Fattore B', FACTORS, 6), pct('Gain B'),
      enm('Fattore C', FACTORS, 6), pct('Gain C'), pct('X-Feed'), sw('Mono'), sw('Dry')] },
  { code: 'CRS', name: 'Stereo Chorus', cat: 'modulazione', desc: 'Chorus stereo: allarga e ammorbidisce.',
    params: [speed, pct('Width L', 40), pct('Width R', 40), log('Delay L', 0.5, 50, 'ms', 10), log('Delay R', 0.5, 50, 'ms', 12), mix,
      loCut, hiCut, phase, pct('Forma onda'), pct('Spread')] },
  { code: 'FLNG', name: 'Stereo Flanger', cat: 'modulazione', desc: 'Flanger stereo con feedback filtrato.',
    params: [speed, pct('Width L', 40), pct('Width R', 40), log('Delay L', 0.5, 20, 'ms', 2), log('Delay R', 0.5, 20, 'ms', 3), mix,
      loCut, hiCut, phase, log('Feed lo cut', 10, 500, 'Hz', 50), log('Feed hi cut', 200, 20000, 'Hz', 8000), bip('Feedback', 90)] },
  { code: 'PHAS', name: 'Stereo Phaser', cat: 'modulazione', desc: 'Phaser stereo con modulazione da inviluppo.',
    params: [speed, pct('Depth'), lin('Risonanza', 0, 80, '', 30), lin('Base', 1, 50, '', 10), lin('Stadi', 2, 12, '', 6), mix,
      bip('Forma onda', 50), phase, bip('Env mod'), log('Attack', 10, 1000, 'ms', 50), log('Hold', 1, 2000, 'ms', 50), log('Release', 10, 1000, 'ms', 200)] },
  { code: 'DIMC', name: 'Dimensional Chorus', cat: 'modulazione', desc: 'Chorus "Dimension" a pulsanti, molto naturale.',
    params: [sw('Attivo', 1), enm('Modo', ['M', 'ST'], 1), sw('Dry'), sw('Tasto 1', 1), sw('Tasto 2'), sw('Tasto 3', 1), sw('Tasto 4')] },
  { code: 'FILT', name: 'Mood Filter', cat: 'modulazione', desc: 'Filtro risonante modulato (auto-wah).',
    params: [log('Velocità', 0.05, 20, 'Hz', 1), enm('Modo', ['LP', 'HP', 'BP', 'NO']), enm('Forma onda', ['TRI', 'SIN', 'SAW+', 'SAW-', 'RMP', 'SQU', 'RND']),
      pct('Depth'), pct('Risonanza'), log('Base', 20, 15000, 'Hz', 500), mix, bip('Env mod'), log('Attack', 10, 250, 'ms', 50),
      log('Release', 10, 500, 'ms', 200), sw('4-Pole'), sw('Side chain')] },
  { code: 'ROTA', name: 'Rotary Speaker', cat: 'modulazione', desc: 'Simulazione di altoparlante rotante (Leslie).',
    params: [log('Lo speed', 0.1, 4, 'Hz', 0.7), log('Hi speed', 2, 10, 'Hz', 6), pct('Accel.'), pct('Distanza'), bip('Bilanciamento'), mix, sw('Stop'), enm('Velocità', ['SLOW', 'FAST'])] },
  { code: 'PAN', name: 'Tremolo / Panner', cat: 'modulazione', desc: 'Tremolo o autopan, anche guidato dall\'inviluppo.',
    params: [speed, phase, bip('Forma onda', 50), pct('Depth'), pct('Env speed'), pct('Env depth'),
      log('Attack', 10, 1000, 'ms', 50), log('Hold', 1, 2000, 'ms', 50), log('Release', 10, 1000, 'ms', 200)] },
  { code: 'SUB', name: 'Suboctaver', cat: 'modulazione', desc: 'Genera una e due ottave sotto (doppio).',
    params: dual(x => [enm(`Range ${x}`, ['LO', 'MID', 'HI'], 1), pct(`Dry ${x}`), pct(`Oct 1 ${x}`), pct(`Oct 2 ${x}`)]) },
  { code: 'D/RV', name: 'Delay + Chamber', cat: 'combinati', desc: 'Delay seguito da camera riverberante.',
    params: [time, enm('Pattern', FACTORS, 6), log('Feed hi cut', 200, 20000, 'Hz', 8000), delayFeed, pct('X-Feed'), bip('Bilanciamento'),
      preDelay, log('Decay', 0.1, 5, 's', 1.5), lin('Size', 2, 100, '', 50), damping, loCut, mix] },
  { code: 'CR/R', name: 'Chorus + Chamber', cat: 'combinati', desc: 'Chorus e camera riverberante insieme.',
    params: [speed, pct('Depth'), log('Delay', 0.5, 50, 'ms', 10), phase, pct('Forma onda'), bip('Bilanciamento'),
      preDelay, log('Decay', 0.1, 5, 's', 1.5), lin('Size', 2, 100, '', 50), damping, loCut, mix] },
  { code: 'FL/R', name: 'Flanger + Chamber', cat: 'combinati', desc: 'Flanger e camera riverberante insieme.',
    params: [speed, pct('Depth'), log('Delay', 0.5, 20, 'ms', 2), phase, bip('Feedback', 90), bip('Bilanciamento'),
      preDelay, log('Decay', 0.1, 5, 's', 1.5), lin('Size', 2, 100, '', 50), damping, loCut, mix] },
  { code: 'D/CR', name: 'Delay + Chorus', cat: 'combinati', desc: 'Delay seguito da chorus.',
    params: [time, enm('Pattern', FACTORS, 6), log('Feed hi cut', 200, 20000, 'Hz', 8000), delayFeed, pct('X-Feed'), bip('Bilanciamento'),
      speed, pct('Depth'), log('Delay', 0.5, 50, 'ms', 10), phase, pct('Forma onda'), mix] },
  { code: 'D/FL', name: 'Delay + Flanger', cat: 'combinati', desc: 'Delay seguito da flanger.',
    params: [time, enm('Pattern', FACTORS, 6), log('Feed hi cut', 200, 20000, 'Hz', 8000), delayFeed, pct('X-Feed'), bip('Bilanciamento'),
      speed, pct('Depth'), log('Delay', 0.5, 20, 'ms', 2), phase, bip('Feedback', 90), mix] },
  { code: 'MODD', name: 'Modulation Delay', cat: 'delay', desc: 'Delay con modulazione e riverbero, molto musicale.',
    params: [time, enm('Fattore', ['1', '1/2', '2/3', '3/2']), pct('Feedback', 30), loCut, hiCut, pct('Depth', 20), log('Velocità', 0.05, 10, 'Hz', 1),
      enm('Setup', ['PAR', 'SER'], 1), enm('Tipo riverbero', ['AMB', 'SML', 'LRG'], 1), lin('Decay', 1, 10, 's', 5), damping,
      bip('Bilanciamento'), mix] },
  { code: 'GEQ2', name: 'Dual Graphic EQ', cat: 'eq', desc: 'Due EQ grafici a 31 bande (es. due monitor).',
    params: [...geqBands(' A'), db('Livello A', -15, 15), ...geqBands(' B'), db('Livello B', -15, 15)] },
  { code: 'GEQ', name: 'Stereo Graphic EQ', cat: 'eq', desc: 'EQ grafico stereo a 31 bande.',
    params: [...geqBands(''), db('Livello', -15, 15)] },
  { code: 'TEQ2', name: 'Dual TruEQ', cat: 'eq', desc: 'Due EQ grafici a 31 bande con risposta reale.',
    params: [...geqBands(' A'), db('Livello A', -15, 15), ...geqBands(' B'), db('Livello B', -15, 15)] },
  { code: 'TEQ', name: 'Stereo TruEQ', cat: 'eq', desc: 'EQ grafico stereo a 31 bande con risposta reale.',
    params: [...geqBands(''), db('Livello', -15, 15)] },
  { code: 'DES2', name: 'Dual DeEsser', cat: 'dinamiche', desc: 'Due de-esser per voci (riduce le sibilanti).',
    params: [pct('Low A', 0), pct('High A', 0), pct('Low B', 0), pct('High B', 0), enm('Voce A', ['FEM', 'MALE']), enm('Voce B', ['FEM', 'MALE'])] },
  { code: 'DES', name: 'Stereo DeEsser', cat: 'dinamiche', desc: 'De-esser stereo o M/S per voci.',
    params: [pct('Low', 0), pct('High', 0), pct('Low S', 0), pct('High S', 0), enm('Voce', ['FEM', 'MALE']), enm('Modo', ['ST', 'MS'])] },
  { code: 'P1A', name: 'Stereo Xtec EQ1', cat: 'eq', desc: 'EQ passivo stile Pultec, caldo e musicale.',
    params: [sw('Attivo', 1), db('Gain', -12, 12), enm('Lo freq', ['20', '30', '60', '100'], 2), lin('Lo boost', 0, 10, '', 0), lin('Lo atten', 0, 10, '', 0),
      lin('Hi width', 0, 10, '', 5), enm('Hi freq', ['3k', '4k', '5k', '8k', '10k', '12k', '16k'], 3), lin('Hi boost', 0, 10, '', 0),
      enm('Hi atten freq', ['5k', '10k', '20k'], 1), lin('Hi atten', 0, 10, '', 0), sw('Trasformatore', 1)] },
  { code: 'P1A2', name: 'Dual Xtec EQ1', cat: 'eq', desc: 'Due EQ passivi stile Pultec.',
    params: dual(x => [sw(`Attivo ${x}`, 1), db(`Gain ${x}`, -12, 12), enm(`Lo freq ${x}`, ['20', '30', '60', '100'], 2), lin(`Lo boost ${x}`, 0, 10, '', 0),
      lin(`Lo atten ${x}`, 0, 10, '', 0), lin(`Hi width ${x}`, 0, 10, '', 5), enm(`Hi freq ${x}`, ['3k', '4k', '5k', '8k', '10k', '12k', '16k'], 3),
      lin(`Hi boost ${x}`, 0, 10, '', 0), enm(`Hi atten freq ${x}`, ['5k', '10k', '20k'], 1), lin(`Hi atten ${x}`, 0, 10, '', 0), sw(`Trasf. ${x}`, 1)]) },
  { code: 'PQ5', name: 'Stereo Xtec EQ5', cat: 'eq', desc: 'EQ medi stile Pultec MEQ-5.',
    params: [sw('Attivo', 1), db('Gain', -12, 12), enm('Lo freq', ['200', '300', '500', '700', '1k'], 2), lin('Lo boost', 0, 10, '', 0),
      enm('Mid freq', ['200', '300', '500', '700', '1k', '1k5', '2k', '3k', '4k', '5k', '7k'], 4), lin('Mid cut', 0, 10, '', 0),
      enm('Hi freq', ['1k5', '2k', '3k', '4k', '5k'], 2), lin('Hi boost', 0, 10, '', 0), sw('Trasformatore', 1)] },
  { code: 'PQ5S', name: 'Dual Xtec EQ5', cat: 'eq', desc: 'Due EQ medi stile Pultec MEQ-5.',
    params: dual(x => [sw(`Attivo ${x}`, 1), db(`Gain ${x}`, -12, 12), enm(`Lo freq ${x}`, ['200', '300', '500', '700', '1k'], 2), lin(`Lo boost ${x}`, 0, 10, '', 0),
      enm(`Mid freq ${x}`, ['200', '300', '500', '700', '1k', '1k5', '2k', '3k', '4k', '5k', '7k'], 4), lin(`Mid cut ${x}`, 0, 10, '', 0),
      enm(`Hi freq ${x}`, ['1k5', '2k', '3k', '4k', '5k'], 2), lin(`Hi boost ${x}`, 0, 10, '', 0), sw(`Trasf. ${x}`, 1)]) },
  { code: 'WAVD', name: 'Wave Designer', cat: 'dinamiche', desc: 'Modella attacco e sustain dei transienti (doppio).',
    params: dual(x => [bip(`Attack ${x}`), bip(`Sustain ${x}`), db(`Out gain ${x}`, -24, 24)]) },
  { code: 'LIM', name: 'Precision Limiter', cat: 'dinamiche', desc: 'Limiter trasparente per il master.',
    params: [db('In gain', 0, 18), db('Out gain', -18, 0), pct('Squeeze', 0), lin('Knee', 0, 10, '', 3), log('Attack', 0.05, 1, 'ms', 0.5),
      log('Release', 20, 2000, 'ms', 200), sw('Link stereo', 1), sw('Auto gain')] },
  { code: 'CMB', name: 'Stereo Combinator', cat: 'dinamiche', desc: 'Compressore multibanda a 5 bande.',
    params: [sw('Attivo', 1), enm('Solo banda', ['OFF', '1', '2', '3', '4', '5']), pct('Mix', 100), log('Attack', 0, 19, 'ms', 5), sw('Auto release', 1),
      log('Release', 20, 3000, 'ms', 200), pct('SBC'), sw('SBC on'), bip('Crossover', 50), enm('Pendenza', ['12', '48']), pct('Ratio'),
      db('Thr 1', -40, 0), db('Gain 1', -10, 10), sw('Lock 1'), db('Thr 2', -40, 0), db('Gain 2', -10, 10), sw('Lock 2'),
      db('Thr 3', -40, 0), db('Gain 3', -10, 10), sw('Lock 3'), db('Thr 4', -40, 0), db('Gain 4', -10, 10), sw('Lock 4'),
      db('Thr 5', -40, 0), db('Gain 5', -10, 10), sw('Lock 5'), enm('Meter', ['GR', 'SBC', 'PEAK'])] },
  { code: 'CMB2', name: 'Dual Combinator', cat: 'dinamiche', desc: 'Due compressori multibanda a 5 bande.',
    params: dual(x => [sw(`Attivo ${x}`, 1), enm(`Solo banda ${x}`, ['OFF', '1', '2', '3', '4', '5']), pct(`Mix ${x}`, 100), log(`Attack ${x}`, 0, 19, 'ms', 5),
      sw(`Auto rel. ${x}`, 1), log(`Release ${x}`, 20, 3000, 'ms', 200), pct(`SBC ${x}`), sw(`SBC on ${x}`), bip(`Crossover ${x}`, 50),
      enm(`Pendenza ${x}`, ['12', '48']), pct(`Ratio ${x}`), db(`Thr 1 ${x}`, -40, 0), db(`Gain 1 ${x}`, -10, 10), db(`Thr 3 ${x}`, -40, 0), db(`Gain 3 ${x}`, -10, 10),
      db(`Thr 5 ${x}`, -40, 0), db(`Gain 5 ${x}`, -10, 10)]) },
  { code: 'FAC', name: 'Stereo Fair Compressor', cat: 'dinamiche', desc: 'Compressore valvolare stile Fairchild.',
    params: [sw('Attivo', 1), db('In gain', -20, 20), lin('Soglia', 0, 10, '', 5), lin('Tempo', 1, 6, '', 2), lin('DC bias', 0, 100, '', 50),
      db('Out gain', -18, 6), bip('Bilanciamento')] },
  { code: 'FAC1M', name: 'M/S Fair Compressor', cat: 'dinamiche', desc: 'Fairchild in modalità Mid/Side.',
    params: [enm('Modo', ['LR', 'MS'], 1), db('In gain M', -20, 20), lin('Soglia M', 0, 10, '', 5), lin('Tempo M', 1, 6, '', 2), lin('DC bias M', 0, 100, '', 50),
      db('Out gain M', -18, 6), bip('Bilanc. M'), db('In gain S', -20, 20), lin('Soglia S', 0, 10, '', 5), lin('Tempo S', 1, 6, '', 2),
      lin('DC bias S', 0, 100, '', 50), db('Out gain S', -18, 6), bip('Bilanc. S')] },
  { code: 'FAC2', name: 'Dual Fair Compressor', cat: 'dinamiche', desc: 'Due compressori stile Fairchild.',
    params: dual(x => [sw(`Attivo ${x}`, 1), db(`In gain ${x}`, -20, 20), lin(`Soglia ${x}`, 0, 10, '', 5), lin(`Tempo ${x}`, 1, 6, '', 2),
      lin(`DC bias ${x}`, 0, 100, '', 50), db(`Out gain ${x}`, -18, 6), bip(`Bilanc. ${x}`)]) },
  { code: 'LEC', name: 'Stereo Leisure Compressor', cat: 'dinamiche', desc: 'Compressore ottico stile LA-2A, dolce sulle voci.',
    params: [sw('Attivo', 1), pct('Gain'), pct('Peak reduction'), enm('Modo', ['COMP', 'LIM']), db('Out gain', -18, 6)] },
  { code: 'LEC2', name: 'Dual Leisure Compressor', cat: 'dinamiche', desc: 'Due compressori ottici stile LA-2A.',
    params: dual(x => [sw(`Attivo ${x}`, 1), pct(`Gain ${x}`), pct(`Peak red. ${x}`), enm(`Modo ${x}`, ['COMP', 'LIM']), db(`Out gain ${x}`, -18, 6)]) },
  { code: 'ULC', name: 'Stereo Ultimo Compressor', cat: 'dinamiche', desc: 'Compressore FET stile 1176, veloce e grintoso.',
    params: [sw('Attivo', 1), db('In gain', -48, 0, -20), db('Out gain', -48, 0, -20), lin('Attack', 1, 7, '', 4), lin('Release', 1, 7, '', 4),
      enm('Ratio', ['4', '8', '12', '20', 'ALL'])] },
  { code: 'ULC2', name: 'Dual Ultimo Compressor', cat: 'dinamiche', desc: 'Due compressori FET stile 1176.',
    params: dual(x => [sw(`Attivo ${x}`, 1), db(`In gain ${x}`, -48, 0, -20), db(`Out gain ${x}`, -48, 0, -20), lin(`Attack ${x}`, 1, 7, '', 4),
      lin(`Release ${x}`, 1, 7, '', 4), enm(`Ratio ${x}`, ['4', '8', '12', '20', 'ALL'])]) },
  { code: 'ENH2', name: 'Dual Enhancer', cat: 'colore', desc: 'Due enhancer: più presenza su basse, medie e alte.',
    params: dual(x => [db(`Out gain ${x}`, -12, 12), pct(`Spread ${x}`), pct(`Bass gain ${x}`), lin(`Bass freq ${x}`, 1, 50, '', 25),
      pct(`Mid gain ${x}`), lin(`Mid Q ${x}`, 1, 50, '', 25), pct(`Hi gain ${x}`), lin(`Hi freq ${x}`, 1, 50, '', 25), sw(`Solo ${x}`)]) },
  { code: 'ENH', name: 'Stereo Enhancer', cat: 'colore', desc: 'Enhancer stereo: più presenza su basse, medie e alte.',
    params: [db('Out gain', -12, 12), pct('Spread'), pct('Bass gain'), lin('Bass freq', 1, 50, '', 25), pct('Mid gain'), lin('Mid Q', 1, 50, '', 25),
      pct('Hi gain'), lin('Hi freq', 1, 50, '', 25), sw('Solo')] },
  { code: 'EXC2', name: 'Dual Exciter', cat: 'colore', desc: 'Due exciter: aggiungono armoniche e brillantezza.',
    params: dual(x => [log(`Tune ${x}`, 1000, 10000, 'Hz', 4000), pct(`Peak ${x}`), pct(`Zero fill ${x}`), bip(`Timbre ${x}`, 50),
      pct(`Armoniche ${x}`), pct(`Mix ${x}`), sw(`Solo ${x}`)]) },
  { code: 'EXC', name: 'Stereo Exciter', cat: 'colore', desc: 'Exciter stereo: aggiunge armoniche e brillantezza.',
    params: [log('Tune', 1000, 10000, 'Hz', 4000), pct('Peak'), pct('Zero fill'), bip('Timbre', 50), pct('Armoniche'), pct('Mix'), sw('Solo')] },
  { code: 'IMG', name: 'Stereo Imager', cat: 'colore', desc: 'Regola larghezza e posizione dell\'immagine stereo.',
    params: [bip('Bilanciamento'), bip('Mono pan'), bip('Stereo pan'), db('Shelf gain', 0, 12), log('Shelf freq', 100, 1000, 'Hz', 300),
      lin('Shelf Q', 1, 10, '', 5), db('Out gain', -12, 12)] },
  { code: 'EDI', name: 'Edison EX1', cat: 'colore', desc: 'Allargatore stereo e bilanciamento M/S.',
    params: [sw('Attivo', 1), enm('Ingresso', ['ST', 'MS']), enm('Uscita', ['ST', 'MS']), bip('Spread stereo', 50), bip('Spread LMF', 50),
      bip('Bilanciamento', 50), bip('Distanza centro', 50), db('Out gain', -12, 12)] },
  { code: 'SON', name: 'Sound Maxer', cat: 'colore', desc: 'Ridà definizione a basse e alte (doppio).',
    params: dual(x => [sw(`Attivo ${x}`, 1), lin(`Lo contour ${x}`, 0, 10, '', 5), lin(`Process ${x}`, 0, 10, '', 5), db(`Out gain ${x}`, -12, 12)]) },
  { code: 'AMP2', name: 'Dual Guitar Amp', cat: 'colore', desc: 'Due simulazioni di amplificatore per chitarra.',
    params: dual(x => [lin(`Preamp ${x}`, 0, 10, '', 5), lin(`Buzz ${x}`, 0, 10, '', 5), lin(`Punch ${x}`, 0, 10, '', 5), lin(`Crunch ${x}`, 0, 10, '', 5),
      lin(`Drive ${x}`, 0, 10, '', 5), lin(`Livello ${x}`, 0, 10, '', 5), lin(`Low ${x}`, 0, 10, '', 5), lin(`High ${x}`, 0, 10, '', 5), sw(`Cabinet ${x}`, 1)]) },
  { code: 'AMP', name: 'Stereo Guitar Amp', cat: 'colore', desc: 'Simulazione di amplificatore per chitarra.',
    params: [lin('Preamp', 0, 10, '', 5), lin('Buzz', 0, 10, '', 5), lin('Punch', 0, 10, '', 5), lin('Crunch', 0, 10, '', 5), lin('Drive', 0, 10, '', 5),
      lin('Livello', 0, 10, '', 5), lin('Low', 0, 10, '', 5), lin('High', 0, 10, '', 5), sw('Cabinet', 1)] },
  { code: 'DRV2', name: 'Dual Tube Stage', cat: 'colore', desc: 'Due stadi valvolari: saturazione calda.',
    params: dual(x => [pct(`Drive ${x}`), pct(`Pari ${x}`), pct(`Dispari ${x}`), db(`Gain ${x}`, -12, 12), log(`Lo cut ${x}`, 10, 500, 'Hz', 20),
      log(`Hi cut ${x}`, 200, 20000, 'Hz', 20000), db(`Lo gain ${x}`, -12, 12), log(`Lo freq ${x}`, 50, 400, 'Hz', 100),
      db(`Hi gain ${x}`, -12, 12), log(`Hi freq ${x}`, 1000, 10000, 'Hz', 4000)]) },
  { code: 'DRV', name: 'Stereo Tube Stage', cat: 'colore', desc: 'Stadio valvolare stereo: saturazione calda.',
    params: [pct('Drive'), pct('Pari'), pct('Dispari'), db('Gain', -12, 12), log('Lo cut', 10, 500, 'Hz', 20), log('Hi cut', 200, 20000, 'Hz', 20000),
      db('Lo gain', -12, 12), log('Lo freq', 50, 400, 'Hz', 100), db('Hi gain', -12, 12), log('Hi freq', 1000, 10000, 'Hz', 4000)] },
  { code: 'PIT2', name: 'Dual Pitch Shifter', cat: 'modulazione', desc: 'Due voci trasposte, per armonizzare o ispessire.',
    params: [lin('Semitoni 1', -12, 12, '', 0), lin('Cent 1', -50, 50, '', 0), lin('Delay 1', 1, 100, 'ms', 10), db('Gain 1', -12, 12), bip('Pan 1'),
      lin('Semitoni 2', -12, 12, '', 0), lin('Cent 2', -50, 50, '', 0), lin('Delay 2', 1, 100, 'ms', 10), db('Gain 2', -12, 12), bip('Pan 2'),
      loCut, hiCut, mix] },
  { code: 'PIT', name: 'Stereo Pitch Shifter', cat: 'modulazione', desc: 'Traspone il suono di semitoni e cent.',
    params: [lin('Semitoni', -12, 12, '', 0), lin('Cent', -50, 50, '', 0), lin('Delay', 1, 100, 'ms', 10), loCut, hiCut, mix] },
];

export const FX_CATEGORIES = [
  { id: 'riverberi', label: 'Riverberi' },
  { id: 'delay', label: 'Delay' },
  { id: 'modulazione', label: 'Modulazione' },
  { id: 'combinati', label: 'Combinati' },
  { id: 'eq', label: 'EQ' },
  { id: 'dinamiche', label: 'Dinamiche' },
  { id: 'colore', label: 'Colore e saturazione' },
];

/** Effetti i cui parametri sono stati confrontati con dati reali del mixer o con X-AIR-Edit. */
export const FX_VERIFIED = new Set(['HALL', 'VRM', 'MODD', 'PLAT', 'D/CR']);

export const FX_SLOTS = [1, 2, 3, 4];
export const FX_PARAM_COUNT = 64;
const GENERIC_COUNT = 16;

export const FX_TYPE_SPEC = enm('Effetto', FX_TYPES.map(t => t.name), 0);

export const fxTypeAddress = slot => `/fx/${slot}/type`;
export const fxParamAddress = (slot, i) => `/fx/${slot}/par/${pad2(i + 1)}`;

/** Parametri di un tipo di effetto; mapped = false se il tipo non è noto (controlli generici). */
export function fxParams(typeIndex) {
  const type = FX_TYPES[typeIndex];
  if (type?.params) return { mapped: true, params: type.params };
  return { mapped: false, params: Array.from({ length: GENERIC_COUNT }, (_, i) => pct(`Par ${i + 1}`)) };
}

/** Posizione del parametro "Tempo" dei delay (per il tap tempo), -1 se l'effetto non ce l'ha. */
export const tapIndex = typeIndex => FX_TYPES[typeIndex]?.params?.indexOf(time) ?? -1;

/** Tutti gli indirizzi FX da leggere alla connessione. */
export function fxAddresses() {
  return FX_SLOTS.flatMap(slot => [
    fxTypeAddress(slot),
    ...Array.from({ length: FX_PARAM_COUNT }, (_, i) => fxParamAddress(slot, i)),
  ]);
}

// Effetti caricati nel simulatore: Hall, Plate, Stereo Delay, Stereo Chorus.
export const SIM_FX_TYPES = [0, 5, 10, 13];
