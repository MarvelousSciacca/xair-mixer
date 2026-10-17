// Scheda Routing: da dove arriva il segnale di ogni canale (ingresso analogico o ritorno USB)
// e cosa esce da Aux out, USB e Ultranet, con i preset di X-AIR-Edit.

import { Scope, choice } from './controls.js';
import { SPEC } from './params.js';
import { ROUTING, ROUTING_SOURCES, ROUTING_POS, ROUTING_POS_VERIFIED, routingAddress, routingPosAddress, sourceIndex } from './model.js';
import { applyColor } from './ui.js';
import { ask, notify } from './dialogs.js';

const pad2 = n => String(n).padStart(2, '0');

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

const sourceSpec = { kind: 'enum', label: 'Sorgente', options: ROUTING_SOURCES, def: 0 };
const posSpec = { kind: 'enum', label: 'Prelievo', options: ROUTING_POS.map(([, name]) => name), def: 0 };
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

// --- preset (da X-AIR-Edit). Solo sorgenti e interruttori verificati: il prelievo non si tocca. ----

const chIn = n => [`/ch/${pad2(n)}/preamp/rtnsw`, 0, 'i'];
const chUsb = n => [[`/ch/${pad2(n)}/preamp/rtnsw`, 1, 'i'], [`/ch/${pad2(n)}/config/rtnsrc`, n - 1, 'i']];
const out = (id, codes) => codes.map((code, i) => [routingAddress(id, i + 1), sourceIndex(code), 'i']);
const chCodes = n => range(n, i => `Ch${pad2(i)}`);

const PRESETS = {
  inputs: [
    { name: 'Tutto analogico', desc: 'Ogni canale prende il suo ingresso: la configurazione per suonare dal vivo.',
      values: [...range(16, chIn), ['/rtn/aux/preamp/rtnsw', 0, 'i']] },
    { name: 'Ch 1-16 da USB', desc: 'Ogni canale prende la traccia USB con lo stesso numero: per riascoltare una registrazione.',
      values: range(16, chUsb).flat() },
    { name: 'USB 1-2 all\'Aux', desc: 'Il canale Aux prende le tracce USB 1-2 (musica dal computer).',
      values: [['/rtn/aux/preamp/rtnsw', 1, 'i'], ['/rtn/aux/config/rtnsrc', 0, 'i']] },
  ],
  usb: [
    { name: 'In 1-18', desc: 'Registrazione multitraccia: Ch 1-16 e Aux L/R sulle tracce USB 1-18.',
      values: out('usb', [...chCodes(16), 'AuxL', 'AuxR']) },
    { name: 'Ch 1-16 + Main LR', desc: 'Ch 1-16 e il mix principale sulle tracce 17-18.',
      values: out('usb', [...chCodes(16), 'L', 'R']) },
    { name: 'Bus + FX', desc: 'Ritorni effetti, bus 1-6, Main LR e Aux sulle tracce USB.',
      values: out('usb', ['Fx1L', 'Fx1R', 'Fx2L', 'Fx2R', 'Fx3L', 'Fx3R', 'Fx4L', 'Fx4R', ...range(6, i => `Bus${i}`), 'L', 'R', 'AuxL', 'AuxR']) },
  ],
  p16: [
    { name: 'Ch 1-16', desc: 'Ai monitor personali Ultranet arrivano i 16 canali.', values: out('p16', chCodes(16)) },
    { name: 'Ch 1-8 + Bus + LR', desc: 'Canali 1-8, bus 1-6 e Main LR.', values: out('p16', [...chCodes(8), ...range(6, i => `Bus${i}`), 'L', 'R']) },
    { name: 'Ch 1-8 + FX', desc: 'Canali 1-8 e i ritorni dei 4 effetti.', values: out('p16', [...chCodes(8), 'Fx1L', 'Fx1R', 'Fx2L', 'Fx2R', 'Fx3L', 'Fx3R', 'Fx4L', 'Fx4R']) },
  ],
};

export function createRouting({ mixer, strips, container }) {
  const sc = new Scope(mixer);
  const root = h('div', 'routing');
  let undo = null;

  async function applyPreset(p) {
    const ok = await ask({ title: `Applicare "${p.name}"?`, message: `${p.desc}\nPuoi annullare subito dopo.`, confirmText: 'Applica' });
    if (!ok) return;
    // per poter annullare servono i valori attuali: quelli non ancora letti si chiedono al mixer
    const missing = () => p.values.filter(([a]) => mixer.get(a) === undefined).map(([a]) => a);
    if (missing().length) {
      mixer.query(missing(), { priority: true });
      for (let t = 0; t < 30 && missing().length; t++) await new Promise(res => setTimeout(res, 50));
    }
    const before = p.values.map(([a, , type]) => [a, mixer.get(a), type]);
    for (const [a, v, type] of p.values) mixer.set(a, v, type);
    undo = () => before.forEach(([a, v, type]) => v !== undefined && mixer.set(a, v, type));
    undoBtn.hidden = false;
    notify(`Preset "${p.name}" applicato`);
  }
  const undoBtn = h('button', 'btn ghost', 'Annulla ultimo preset');
  undoBtn.type = 'button';
  undoBtn.hidden = true;
  undoBtn.addEventListener('click', () => {
    undo?.();
    undo = null;
    undoBtn.hidden = true;
  });

  const presetBar = list => {
    const bar = h('div', 'rt-presets');
    bar.append(h('span', 'rt-presets-label', 'Preset'));
    for (const p of list) {
      const b = h('button', 'chip-btn', p.name);
      b.type = 'button';
      b.title = p.desc;
      b.addEventListener('click', () => applyPreset(p));
      bar.append(b);
    }
    return bar;
  };
  const block = (title, sub, presets, body) => {
    const sec = h('section', 'rt-block');
    const head = h('header', 'rt-head');
    const titles = h('div');
    titles.append(h('h2', null, title), h('p', 'rt-sub', sub));
    head.append(titles);
    if (presets) head.append(presetBar(presets));
    sec.append(head, body);
    return sec;
  };

  // --- ingressi -----------------------------------------------------------------------------
  const inputs = h('div', 'rt-inputs');
  for (const s of strips.filter(x => x.source)) {
    const card = h('div', 'rt-in');
    const name = h('div', 'rt-in-name');
    const label = h('strong');
    sc.on(`${s.base}/config/name`, n => { label.textContent = n || s.label; });
    label.textContent = mixer.get(`${s.base}/config/name`) || s.label;
    name.append(h('span', 'chip'), label, h('span', 'rt-in-num', s.label));
    sc.on(`${s.base}/config/color`, c => applyColor(name, c));
    applyColor(name, mixer.get(`${s.base}/config/color`, 0));

    const sw = `${s.base}/preamp/rtnsw`;
    const analog = s.source === 'ch'
      ? choice(sc, `${s.base}/config/insrc`, SPEC.insrc(s.headamp - 1), { label: 'Ingresso' })
      : h('div', 'rt-fixed', 'Aux In');
    const usb = choice(sc, `${s.base}/config/rtnsrc`, s.source === 'ch' ? SPEC.rtnsrc(s.headamp - 1) : SPEC.auxRtnsrc, { label: 'Traccia USB' });
    sc.on(sw, v => {
      card.classList.toggle('is-usb', !!v);
      analog.classList.toggle('inactive', !!v);
      usb.classList.toggle('inactive', !v);
    });
    card.append(name, choice(sc, sw, SPEC.rtnsw, { label: 'Sorgente' }), analog, usb);
    inputs.append(card);
  }

  // --- uscite -------------------------------------------------------------------------------
  const outputs = h('div', 'rt-outputs');
  const OUT_INFO = {
    aux: 'Le uscite analogiche Aux 1-6 sul retro del mixer (di solito i monitor).',
    usb: 'Le tracce che il computer riceve via USB per registrare.',
    p16: 'Il connettore Ultranet per i monitor personali (es. Behringer P16).',
  };
  for (const group of ROUTING) {
    const list = h('div', 'rt-out-list');
    for (let n = 1; n <= group.count; n++) {
      const row = h('div', 'rt-out');
      row.append(
        h('span', 'rt-out-num', `${group.label} ${n}`),
        choice(sc, routingAddress(group.id, n), sourceSpec, { label: 'Sorgente' }),
        choice(sc, routingPosAddress(group.id, n), posSpec, { label: 'Prelievo' }),
      );
      list.append(row);
    }
    const box = block(group.label, OUT_INFO[group.id], PRESETS[group.id], list);
    box.classList.add('rt-out-block');
    outputs.append(box);
  }

  const intro = h('div', 'rt-intro');
  intro.append(
    h('p', 'rt-sub', 'Un preset cambia solo le sorgenti; il punto di prelievo resta com\'è.'
      + (ROUTING_POS_VERIFIED ? '' : ' La numerazione dei punti di prelievo è ancora da verificare sul mixer.')),
    undoBtn,
  );
  root.append(
    intro,
    block('Ingressi', 'Da dove arriva il segnale di ogni canale: ingresso analogico o traccia USB dal computer.', PRESETS.inputs, inputs),
    outputs,
  );
  container.append(root);
  return root;
}
