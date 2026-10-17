// Pannello di modifica del canale: Ingresso (preamp), Gate, EQ, Compressore.

import { SPEC, paramMap, sendAddress } from './params.js';
import { Scope, knob, toggle, choice, bitToggle } from './controls.js';
import { ZERO_DB } from './mixer.js';
import { AUTOMIX } from './model.js';
import { fxControls } from './fx-ui.js';
import { eqGraph, dynGraph, BAND_COLORS } from './graphs.js';
import { eqTypePicker, eqPresetBar, bandTitle } from './eq-ui.js';
import { isCut } from './dsp.js';
import { applyColor } from './ui.js';

const TABS = [
  { id: 'input', label: 'Ingresso', has: s => s.headamp || s.preamp || s.insert || s.source },
  { id: 'gate', label: 'Gate', has: s => s.gate },
  { id: 'eq', label: 'EQ', has: s => s.eqBands },
  { id: 'dyn', label: 'Compressore', has: s => s.dyn },
  { id: 'sends', label: 'Mandate', has: s => s.sends || s.lrAssign },
  { id: 'groups', label: 'Gruppi', has: s => s.groups || s.automix },
  { id: 'fx', label: 'Effetto', has: s => s.fx },
];

// Nome della destinazione di una mandata: 1-6 bus, 7-10 effetti.
const sendTarget = n => (n <= 6
  ? { address: `/bus/${n}/config/name`, label: `Bus ${n}` }
  : { address: `/fxsend/${n - 6}/config/name`, label: `FX ${n - 6}` });

export const hasProcessing = strip => TABS.some(t => t.has(strip));

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function section(title, ...children) {
  const sec = h('section', 'ed-section');
  if (title) sec.append(h('h3', null, title));
  const body = h('div', 'ed-row');
  body.append(...children);
  sec.append(body);
  return sec;
}

export function createEditor(mixer, strips, { rta = null, feedback = null, links = null } = {}) {
  const editable = strips.filter(hasProcessing);
  const root = h('div', 'editor');
  root.hidden = true;
  root.innerHTML = `
    <div class="editor-panel" role="dialog" aria-modal="true">
      <header class="editor-head">
        <button class="icon-btn prev" type="button" aria-label="Canale precedente">‹</button>
        <div class="editor-title"><span class="chip"></span><strong class="name"></strong><span class="sub"></span></div>
        <button class="icon-btn next" type="button" aria-label="Canale successivo">›</button>
        <nav class="editor-tabs" role="tablist"></nav>
        <button class="icon-btn close" type="button" aria-label="Chiudi">✕</button>
      </header>
      <div class="editor-body"></div>
    </div>`;
  document.body.append(root);

  const $ = sel => root.querySelector(sel);
  const body = $('.editor-body');
  const tabsEl = $('.editor-tabs');
  let scope = null;
  let current = null;
  let tab = 'eq';

  const builders = {
    input(sc, s, params) {
      const p = a => params.get(a);
      const parts = [];
      if (s.source) parts.push(sourceSection(sc, s, params));
      if (s.headamp) {
        const ha = `/headamp/${String(s.headamp).padStart(2, '0')}`;
        parts.push(section('Preamp',
          knob(sc, `${ha}/gain`, p(`${ha}/gain`), { big: true }),
          toggle(sc, `${ha}/phantom`, SPEC.phantom, { className: 'warn' })));
      }
      if (s.preamp) {
        parts.push(section('Fase e Low Cut',
          toggle(sc, `${s.base}/preamp/invert`, SPEC.invert),
          toggle(sc, `${s.base}/preamp/hpon`, SPEC.hpon),
          knob(sc, `${s.base}/preamp/hpf`, SPEC.hpf, { label: 'Frequenza' })));
      }
      if (s.insert) {
        parts.push(section('Insert FX',
          toggle(sc, `${s.base}/insert/on`, SPEC.insertOn),
          choice(sc, `${s.base}/insert/sel`, SPEC.insertSlot)));
      }
      if (!s.eqBands) return parts;
      const graph = eqGraph(sc, s, { rta, feedback });
      const box = h('div', 'graph-box');
      box.append(graph.el);
      return [...parts, box];
    },

    gate(sc, s) {
      const a = k => `${s.base}/gate/${k}`;
      const g = SPEC.gate;
      return dynLayout(dynGraph(sc, s, 'gate'), [
        section(null, toggle(sc, a('on'), g.on, { className: 'big' }), choice(sc, a('mode'), g.mode)),
        section('Parametri', ...['thr', 'range', 'attack', 'hold', 'release'].map(k => knob(sc, a(k), g[k]))),
        section('Filtro sidechain',
          toggle(sc, a('filter/on'), g['filter/on'], { label: 'Filtro' }),
          choice(sc, a('filter/type'), g['filter/type'], { label: 'Tipo' }),
          knob(sc, a('filter/f'), g['filter/f'], { label: 'Frequenza' })),
      ]);
    },

    dyn(sc, s) {
      const a = k => `${s.base}/dyn/${k}`;
      const d = SPEC.dyn;
      return dynLayout(dynGraph(sc, s, 'dyn'), [
        section(null,
          toggle(sc, a('on'), d.on, { className: 'big' }),
          toggle(sc, a('auto'), d.auto, { label: 'Auto time' }),
          choice(sc, a('mode'), d.mode), choice(sc, a('det'), d.det), choice(sc, a('env'), d.env)),
        section('Parametri', ...['thr', 'ratio', 'knee', 'mgain', 'attack', 'hold', 'release', 'mix'].map(k => knob(sc, a(k), d[k]))),
        section('Filtro sidechain',
          toggle(sc, a('filter/on'), d['filter/on'], { label: 'Filtro' }),
          choice(sc, a('filter/type'), d['filter/type'], { label: 'Tipo' }),
          knob(sc, a('filter/f'), d['filter/f'], { label: 'Frequenza' })),
      ]);
    },

    sends(sc, s, params) {
      const parts = [];
      if (s.lrAssign) parts.push(section('Uscita', toggle(sc, `${s.base}/mix/lr`, SPEC.lr, { label: 'Main LR' })));
      if (s.sends) {
        const grid = h('div', 'send-grid');
        for (let n = 1; n <= s.sends; n++) {
          const target = sendTarget(n);
          const card = h('div', `send-card${n > 6 ? ' fx' : ''}`);
          const title = h('div', 'send-title', target.label);
          sc.on(target.address, name => { title.textContent = name || target.label; });
          const tap = `${s.base}/mix/${String(n).padStart(2, '0')}/tap`;
          card.append(title,
            knob(sc, sendAddress(s, n), SPEC.send, { label: 'Livello', reset: ZERO_DB }),
            choice(sc, tap, params.get(tap), { label: 'Prelievo' }));
          grid.append(card);
        }
        const sec = h('section', 'ed-section');
        sec.append(h('h3', null, 'Mandate'), grid);
        parts.push(sec);
      }
      return parts;
    },

    groups(sc, s) {
      const dca = `${s.base}/grp/dca`;
      const mute = `${s.base}/grp/mute`;
      const parts = [];
      if (links?.pair(s)) {
        const btn = h('button', 'toggle big');
        btn.type = 'button';
        const render = () => {
          btn.textContent = `Link stereo ${links.pairLabel(s)}`;
          btn.setAttribute('aria-pressed', String(links.isLinked(s)));
        };
        render();
        sc.add(links.onChange(render));
        btn.addEventListener('click', () => links.setLinked(s, !links.isLinked(s)));
        const info = h('p', 'fx-note', 'Attivando il link, le impostazioni del primo canale vengono copiate sul secondo e da lì in poi si muovono insieme. Il pan diventa bilanciamento.');
        parts.push(section('Stereo', btn), info);
      }
      if (s.automix) parts.push(automixSection(sc, s));
      if (!s.groups) return parts;
      return [
        ...parts,
        section('DCA', ...[0, 1, 2, 3].map(i =>
          bitToggle(sc, dca, SPEC.dcaMask, i, { label: `DCA ${i + 1}`, labelAddress: `/dca/${i + 1}/config/name` }))),
        section('Mute group', ...[0, 1, 2, 3].map(i =>
          bitToggle(sc, mute, SPEC.muteMask, i, { label: `Mute ${i + 1}` }))),
      ];
    },

    fx(sc, s) {
      const { type, note, grid } = fxControls(mixer, sc, s.fx);
      return [section(`Slot FX ${s.fx}`, type), note, grid];
    },

    eq(sc, s, params) {
      const columns = [];
      const graph = eqGraph(sc, s, {
        rta,
        feedback,
        onSelect: i => columns.forEach((c, j) => c.classList.toggle('selected', i === j)),
      });
      const box = h('div', 'graph-box');
      box.append(graph.el);

      const bands = h('div', 'eq-bands');
      for (let i = 0; i < s.eqBands; i++) {
        const b = `${s.base}/eq/${i + 1}`;
        const col = h('div', 'eq-band');
        col.style.setProperty('--c', BAND_COLORS[i]);
        const typeSpec = params.get(`${b}/type`);
        col.append(
          bandTitle(sc, `${b}/f`, params.get(`${b}/f`), i + 1),
          eqTypePicker(sc, `${b}/type`, typeSpec),
          knob(sc, `${b}/f`, params.get(`${b}/f`), { label: 'Freq.' }),
          Object.assign(knob(sc, `${b}/g`, SPEC.eqG, { label: 'Guadagno' }), { className: 'knob eq-gain' }),
          knob(sc, `${b}/q`, SPEC.eqQ, { label: 'Q' }));
        // i filtri di taglio non hanno guadagno
        sc.on(`${b}/type`, t => col.classList.toggle('cut', isCut(typeSpec.options[t])));
        col.classList.toggle('cut', isCut(typeSpec.options[sc.get(`${b}/type`, typeSpec)]));
        col.addEventListener('pointerdown', () => {
          graph.select(i);
          columns.forEach((c, j) => c.classList.toggle('selected', i === j));
        });
        columns.push(col);
        bands.append(col);
      }
      columns[0].classList.add('selected');
      const head = section(null, toggle(sc, `${s.base}/eq/on`, SPEC.eqOn, { label: 'EQ attivo', className: 'big' }), eqPresetBar(sc, s, params));
      const hint = h('p', 'eq-hint', 'Trascina i punti sul grafico: in orizzontale la frequenza, in verticale il guadagno. Due dita o la rotella del mouse cambiano la larghezza della banda (Q). Doppio tocco: guadagno a zero.');
      return [head, box, hint, bands];
    },
  };

  // Sorgente: preamp analogico o ritorno USB dal computer (per registrare e poi riascoltare).
  function sourceSection(sc, s, params) {
    const sw = `${s.base}/preamp/rtnsw`;
    const analog = h('div', 'src-group');
    const usb = h('div', 'src-group');
    if (s.source === 'ch') analog.append(choice(sc, `${s.base}/config/insrc`, params.get(`${s.base}/config/insrc`)));
    usb.append(choice(sc, `${s.base}/config/rtnsrc`, params.get(`${s.base}/config/rtnsrc`)));
    usb.append(knob(sc, `${s.base}/preamp/rtntrim`, SPEC.rtntrim));
    sc.on(sw, v => {
      analog.classList.toggle('inactive', !!v);
      usb.classList.toggle('inactive', !v);
    });
    const sec = section('Sorgente', choice(sc, sw, SPEC.rtnsw), analog, usb);
    if (s.source === 'aux') sec.append(h('p', 'fx-note', 'Con "Analogico" il canale riceve l\'ingresso Aux In; con "USB" una coppia di ritorni dal computer.'));
    return sec;
  }

  // Automix: i microfoni dello stesso gruppo si abbassano a vicenda quando uno parla.
  function automixSection(sc, s) {
    const sec = section('Automix',
      choice(sc, `${s.base}/automix/group`, SPEC.amixGroup, { label: 'Gruppo' }),
      knob(sc, `${s.base}/automix/weight`, SPEC.amixWeight),
      toggle(sc, AUTOMIX.enable.X, SPEC.amixEnable, { label: 'Automix X attivo' }),
      toggle(sc, AUTOMIX.enable.Y, SPEC.amixEnable, { label: 'Automix Y attivo' }));
    sec.append(h('p', 'fx-note', 'Metti nello stesso gruppo i microfoni parlati (conferenze, talk): il mixer abbassa quelli che non parlano. Il peso dà più o meno precedenza al canale. X e Y si attivano per tutto il mixer.'));
    return sec;
  }

  function dynLayout(graph, controls) {
    const wrap = h('div', 'dyn-layout');
    const box = h('div', 'graph-box square');
    box.append(graph);
    const side = h('div', 'dyn-controls');
    side.append(...controls);
    wrap.append(box, side);
    return [wrap];
  }

  function render() {
    scope?.dispose();
    scope = new Scope(mixer);
    const s = current;

    // Intestazione: nome e colore aggiornati in tempo reale.
    const name = $('.name');
    $('.sub').textContent = s.label;
    scope.on(`${s.base}/config/name`, n => { name.textContent = n || s.label; });
    name.textContent = mixer.get(`${s.base}/config/name`) || s.label;
    scope.on(`${s.base}/config/color`, c => applyColor($('.editor-title'), c));

    const available = TABS.filter(t => t.has(s));
    if (!available.some(t => t.id === tab)) tab = available[0].id;
    tabsEl.innerHTML = '';
    for (const t of available) {
      const b = h('button', 'tab', t.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.id === tab));
      b.addEventListener('click', () => {
        tab = t.id;
        render();
      });
      tabsEl.append(b);
    }

    body.innerHTML = '';
    body.dataset.tab = tab;
    body.append(...builders[tab](scope, s, paramMap(s)));
  }

  function open(strip, wantTab) {
    current = strip;
    if (wantTab) tab = wantTab;
    root.hidden = false;
    render();
  }

  function close() {
    root.hidden = true;
    scope?.dispose();
    scope = null;
    body.innerHTML = '';
  }

  function step(dir) {
    // salta i canali nascosti perché secondi di una coppia in link stereo
    const visible = editable.filter(s => !(links?.isLinked(s) && !links.isPrimary(s)) || s === current);
    const i = visible.indexOf(current);
    open(visible[(i + dir + visible.length) % visible.length]);
  }

  $('.close').addEventListener('click', close);
  $('.prev').addEventListener('click', () => step(-1));
  $('.next').addEventListener('click', () => step(1));
  root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
  document.addEventListener('keydown', e => {
    if (root.hidden) return;
    if (e.key === 'Escape') close();
  });

  return { open, close };
}
