// Copia e incolla delle impostazioni tra canali, per sezioni (gate, EQ, compressore...).
// Gain e +48V non si copiano mai: incollare la phantom su un microfono a nastro può danneggiarlo.

import { stripParams, paramMap, oscType } from './params.js';
import { notify } from './dialogs.js';

/** Sezioni copiabili: rel è l'indirizzo senza la base della strip (es. "/gate/thr"). */
const SECTIONS = [
  { id: 'input', label: 'Fase e low cut', has: s => s.preamp, match: rel => /^\/preamp\/(invert|hpon|hpf)$/.test(rel), on: true },
  { id: 'gate', label: 'Gate', has: s => s.gate, match: rel => rel.startsWith('/gate/'), on: true },
  { id: 'eq', label: 'EQ', has: s => s.eqBands, match: rel => rel.startsWith('/eq/'), on: true },
  { id: 'dyn', label: 'Compressore', has: s => s.dyn, match: rel => rel.startsWith('/dyn/'), on: true },
  { id: 'sends', label: 'Mandate (livelli e prelievo)', has: s => s.sends, match: rel => /^\/mix\/\d\d\/(level|tap)$/.test(rel), on: false },
];

let clip = null; // { from: strip, name, values: Map(rel -> value) }

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

const stripName = (mixer, s) => mixer.get(`${s.base}/config/name`) || s.label;

/** Sezioni che si possono incollare da `from` a `to` (l'EQ solo tra strip con lo stesso numero di bande). */
function compatible(from, to) {
  return SECTIONS.filter(sec => sec.has(from) && sec.has(to) && (sec.id !== 'eq' || from.eqBands === to.eqBands));
}

export function copyStrip(mixer, strip) {
  const values = new Map();
  for (const { address } of stripParams(strip)) {
    if (!address.startsWith(`${strip.base}/`)) continue; // headamp (gain, +48V): mai
    const rel = address.slice(strip.base.length);
    if (!SECTIONS.some(sec => sec.match(rel))) continue;
    const v = mixer.get(address);
    if (v !== undefined) values.set(rel, v);
  }
  clip = { from: strip, name: stripName(mixer, strip), values };
  notify(`Copiate le impostazioni di ${clip.name}`);
}

export const clipboardSource = () => clip;

/** Chiede quali sezioni incollare e le applica: tutto in un solo passo di Annulla. */
export function pasteStrip(mixer, strip) {
  if (!clip) return Promise.resolve(false);
  const sections = compatible(clip.from, strip);
  const target = stripName(mixer, strip);
  return new Promise(resolve => {
    const dialog = h('dialog', 'ask-dialog paste-dialog');
    const form = h('form');
    form.method = 'dialog';
    form.append(h('h2', null, `Incolla su ${target}`));
    if (!sections.length) {
      form.append(h('p', 'ask-message', `${clip.name} e ${target} non hanno sezioni in comune da incollare.`));
    } else {
      form.append(h('p', 'ask-message', `Impostazioni copiate da ${clip.name}. Scegli cosa incollare (gain e +48V non vengono mai copiati).`));
    }
    const boxes = sections.map(sec => {
      const label = h('label', 'paste-option');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = sec.on;
      box.value = sec.id;
      label.append(box, document.createTextNode(sec.label));
      form.append(label);
      return box;
    });
    const actions = h('div', 'dialog-actions');
    const cancel = h('button', 'btn ghost', 'Annulla');
    cancel.type = 'button';
    const ok = h('button', 'btn', 'Incolla');
    ok.type = 'submit';
    ok.disabled = !sections.length;
    const sync = () => { ok.disabled = !boxes.some(b => b.checked); };
    boxes.forEach(b => b.addEventListener('change', sync));
    actions.append(cancel, ok);
    form.append(actions);
    dialog.append(form);

    let done = false;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (ok.disabled) return;
      const chosen = sections.filter((_, i) => boxes[i].checked);
      const params = paramMap(strip);
      let count = 0;
      for (const [rel, value] of clip.values) {
        if (!chosen.some(sec => sec.match(rel))) continue;
        const spec = params.get(strip.base + rel);
        if (!spec) continue; // es. mandata che questa strip non ha
        mixer.set(strip.base + rel, value, oscType(spec));
        count++;
      }
      done = true;
      dialog.close();
      notify(`${chosen.map(s => s.label).join(', ')} incollati su ${target} (${count} parametri)`);
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(done);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
