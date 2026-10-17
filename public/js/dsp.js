// Matematica dei filtri e dell'RTA, condivisa tra interfaccia e simulatore.

import { EQ_TYPES, paramMap, fromNorm, defaultValue } from './params.js';

const FS = 48000;

/** Bande dell'RTA del mixer: 100 bande logaritmiche da 20 Hz a 20 kHz. */
export const RTA_BINS = 100;
export const binFreq = i => 20 * 1000 ** (i / (RTA_BINS - 1));
export const freqBin = f => (Math.log(f / 20) / Math.log(1000)) * (RTA_BINS - 1);

export const isCut = type => type === 'LCut' || type === 'HCut';

/** Coefficienti biquad (formule RBJ) come [b0, b1, b2, a0, a1, a2]. */
export function biquad(type, f, gain, q) {
  const w0 = (2 * Math.PI * f) / FS;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const A = 10 ** (gain / 40);
  const sA = 2 * Math.sqrt(A) * alpha;
  switch (type) {
    case 'LCut':
      return [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
    case 'HCut':
      return [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
    case 'LShv':
      return [
        A * (A + 1 - (A - 1) * cos + sA), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - sA),
        A + 1 + (A - 1) * cos + sA, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - sA,
      ];
    case 'HShv':
      return [
        A * (A + 1 + (A - 1) * cos + sA), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - sA),
        A + 1 - (A - 1) * cos + sA, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - sA,
      ];
    default: // PEQ, VEQ
      return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  }
}

export function magnitudeDb([b0, b1, b2, a0, a1, a2], f) {
  const w = (2 * Math.PI * f) / FS;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const num = (b0 + b1 * c1 + b2 * c2) ** 2 + (b1 * s1 + b2 * s2) ** 2;
  const den = (a0 + a1 * c1 + a2 * c2) ** 2 + (a1 * s1 + a2 * s2) ** 2;
  return 10 * Math.log10(num / den);
}

/** Bande EQ di una strip in valori reali. valueOf(address) restituisce il valore OSC grezzo (o undefined). */
export function stripBands(strip, valueOf) {
  const params = paramMap(strip);
  const raw = a => valueOf(a) ?? defaultValue(params.get(a));
  const real = a => fromNorm(params.get(a), raw(a));
  const bands = [];
  for (let i = 1; i <= (strip.eqBands ?? 0); i++) {
    const b = `${strip.base}/eq/${i}`;
    const type = EQ_TYPES[raw(`${b}/type`)];
    bands.push({ type, f: real(`${b}/f`), g: isCut(type) ? 0 : real(`${b}/g`), q: real(`${b}/q`) });
  }
  return {
    eqOn: strip.eqBands ? !!raw(`${strip.base}/eq/on`) : false,
    hpOn: strip.preamp ? !!raw(`${strip.base}/preamp/hpon`) : false,
    hpf: strip.preamp ? real(`${strip.base}/preamp/hpf`) : 0,
    bands,
  };
}

/** Filtri attivi (EQ acceso + low cut) di una strip. */
export function stripFilters(strip, valueOf) {
  const { eqOn, hpOn, hpf, bands } = stripBands(strip, valueOf);
  const filters = eqOn ? bands.map(b => biquad(b.type, b.f, b.g, b.q)) : [];
  if (hpOn) filters.push(biquad('LCut', hpf, 0, Math.SQRT1_2));
  return filters;
}

export const responseDb = (filters, f) => filters.reduce((sum, c) => sum + magnitudeDb(c, f), 0);
