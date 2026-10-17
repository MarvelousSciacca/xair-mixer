// Controlli di uno slot effetto: scelta del tipo e parametri. Usato dal pannello dei ritorni FX
// e dalla scheda Effetti.

import { Scope, knob, choice, stepper } from './controls.js';
import { FX_TYPE_SPEC, FX_PARAM_COUNT, FX_TYPES, FX_VERIFIED, fxTypeAddress, fxParamAddress, fxParams } from './fx.js';
import { isContinuous } from './params.js';
import { geqControls, GEQ_CODES } from './geq-ui.js';

const GENERIC = (i, label = `Par ${i + 1}`) => ({ kind: 'lin', label, min: 0, max: 100, unit: '%', def: 50 });

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * Restituisce { type, note, grid }: selettore del tipo, nota (se i parametri non sono mappati)
 * e griglia dei parametri, che si ricostruisce quando cambia il tipo di effetto.
 */
export function fxControls(mixer, sc, slot) {
  const typeAddr = fxTypeAddress(slot);
  const note = h('p', 'fx-note');
  const grid = h('div', 'fx-params');
  let inner = null;
  let current = sc.get(typeAddr, FX_TYPE_SPEC);

  // Il mixer risponde NaN per i parametri che l'effetto non usa: così si sa quanti mostrarne.
  const used = () => Array.from({ length: FX_PARAM_COUNT }, (_, i) => mixer.get(fxParamAddress(slot, i)))
    .filter(v => typeof v === 'number' && !Number.isNaN(v)).length; // NaN arriva come null via JSON
  // Firma dei controlli generici mostrati (quanti e di che tipo): se cambia, si ricostruisce.
  const signature = () => `${used()}:${Array.from({ length: used() }, (_, i) => mixer.typeOf(fxParamAddress(slot, i))).join('')}`;
  let shownSignature = '';

  const build = type => {
    inner?.dispose();
    inner = new Scope(mixer);
    grid.innerHTML = '';
    const { mapped, params } = fxParams(type);
    shownSignature = signature();
    // Numero e tipo dei controlli li decide il mixer (parametri non NaN, intero o decimale):
    // se la mappa dei nomi sbaglia, i controlli funzionano comunque.
    const count = used() || params.length;
    // EQ grafici: cursori verticali invece di 32-64 manopole (solo se il mixer conferma i parametri).
    const isGeq = mapped && GEQ_CODES.has(FX_TYPES[type]?.code) && count === params.length;
    grid.classList.toggle('is-geq', isGeq);
    if (isGeq) {
      note.textContent = '';
      grid.append(geqControls(inner, slot, params));
      return;
    }
    note.textContent = !mapped
      ? 'Effetto non riconosciuto: controlli generici.'
      : FX_VERIFIED.has(FX_TYPES[type]?.code) ? '' : 'Nomi dei parametri da X-AIR-Edit; alcuni range sono ancora da verificare sul mixer.';
    for (let i = 0; i < count; i++) {
      const address = fxParamAddress(slot, i);
      const spec = params[i] ?? GENERIC(i);
      const sent = mixer.typeOf(address);
      if (sent === 'i' && isContinuous(spec)) grid.append(stepper(inner, address, { label: spec.label }));
      else if (sent === 'f' && !isContinuous(spec)) grid.append(knob(inner, address, GENERIC(i, spec.label)));
      else grid.append(knob(inner, address, spec));
    }
  };
  build(current);

  // Se i valori arrivano dopo (es. dopo un cambio di tipo), ricostruisce con il numero giusto di controlli.
  let rebuild = null;
  for (let i = 0; i < FX_PARAM_COUNT; i++) {
    sc.on(fxParamAddress(slot, i), () => {
      if (signature() === shownSignature) return;
      clearTimeout(rebuild);
      rebuild = setTimeout(() => build(current), 150);
    });
  }
  sc.on(typeAddr, type => {
    if (type === current) return;
    current = type;
    build(type);
    // Cambiando tipo il mixer carica i parametri predefiniti dell'effetto: li rilegge.
    setTimeout(() => mixer.query(Array.from({ length: FX_PARAM_COUNT }, (_, i) => fxParamAddress(slot, i)), { priority: true }), 300);
  });
  sc.add(() => {
    clearTimeout(rebuild);
    inner?.dispose();
  });

  return { type: choice(sc, typeAddr, FX_TYPE_SPEC), note, grid };
}
