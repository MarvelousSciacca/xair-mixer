// Scaletta per il concerto: gli snapshot dei brani in ordine. Dal vivo si passa al successivo con la
// barra sopra il mixer, con un pedale (PagGiù / PagSu, come i voltapagine Bluetooth) o col MIDI.
// Lo snapshot si carica subito, senza domande; i canali protetti restano com'erano.

import { SNAPSHOTS } from './model.js';

const KEY = 'xair.setlist';
const BUSY_MS = 1200; // tra due cambi: evita di saltare un brano con un doppio colpo di pedale
const pad2 = n => String(n).padStart(2, '0');

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function button(text, className, onClick, label) {
  const b = h('button', className, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function load(storage) {
  try {
    const d = JSON.parse(storage.get(KEY) ?? 'null');
    const items = Array.isArray(d?.items) ? d.items.filter(i => Number.isInteger(i?.slot) && i.slot >= 1 && i.slot <= SNAPSHOTS.count) : [];
    const index = Number.isInteger(d?.index) && d.index < items.length ? d.index : -1;
    return { items, index, bar: d?.bar !== false };
  } catch {
    return { items: [], index: -1, bar: true };
  }
}

export function createSetlist({ mixer, scenes, storage, mixerEl }) {
  const state = load(storage);
  const save = () => storage.set(KEY, JSON.stringify(state));
  const name = slot => (scenes.isEmpty(slot) ? `Snapshot ${pad2(slot)} (vuoto)` : scenes.snapName(slot));
  let busyUntil = 0;

  // --- barra sopra il mixer ----------------------------------------------------------------
  const bar = h('div', 'setlist-bar');
  const prevBtn = button('◀', 'btn ghost sl-prev', () => prev(), 'Brano precedente');
  const info = h('div', 'sl-info');
  const now = h('strong', 'sl-now');
  const upcoming = h('span', 'sl-next');
  info.append(now, upcoming);
  const nextBtn = button('Successivo ▶', 'btn sl-go', () => next(), 'Brano successivo');
  bar.append(prevBtn, info, nextBtn);
  mixerEl.before(bar);

  function renderBar() {
    bar.hidden = !state.bar || !state.items.length;
    const i = state.index;
    now.textContent = i < 0 ? `Scaletta: ${state.items.length} brani` : `${i + 1}/${state.items.length} · ${name(state.items[i].slot)}`;
    const following = state.items[i + 1];
    upcoming.textContent = following ? `Poi: ${name(following.slot)}` : i >= 0 ? 'Ultimo brano' : '';
    nextBtn.textContent = i < 0 ? 'Inizia ▶' : 'Successivo ▶';
    nextBtn.disabled = i >= state.items.length - 1;
    prevBtn.disabled = i <= 0;
  }

  async function goTo(i) {
    if (i < 0 || i >= state.items.length || Date.now() < busyUntil) return false;
    busyUntil = Date.now() + BUSY_MS;
    state.index = i;
    save();
    render();
    await scenes.loadSnapshot(state.items[i].slot, { confirm: false });
    return true;
  }
  const next = () => goTo(state.index + 1);
  const prev = () => goTo(state.index - 1);

  // pedali e tastiera: PagGiù/PagSu sempre (anche a schermo bloccato), frecce se non si sta scrivendo
  window.addEventListener('keydown', e => {
    if (bar.hidden || e.defaultPrevented || document.querySelector('dialog[open]')) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
    const forward = e.key === 'PageDown' || (!typing && e.key === 'ArrowRight' && !e.target.closest?.('[role=slider]'));
    const back = e.key === 'PageUp' || (!typing && e.key === 'ArrowLeft' && !e.target.closest?.('[role=slider]'));
    if (!forward && !back) return;
    e.preventDefault();
    if (forward) next();
    else prev();
  });

  // --- modifica, nella finestra Scene ------------------------------------------------------
  const pane = scenes.setlistPane;
  pane.innerHTML = `
    <p class="fb-help">Metti in ordine gli snapshot dei brani. Dal vivo passi al successivo con la barra sopra
      il mixer, con un pedale (PagGiù / PagSu) o con un controller MIDI. Lo snapshot si carica subito,
      senza domande; i canali protetti restano com'erano.</p>
    <ol class="sl-list"></ol>
    <div class="ed-row sl-add"><select class="sl-pick" aria-label="Snapshot da aggiungere"></select></div>
    <div class="ed-row sl-options"></div>`;
  const list = pane.querySelector('.sl-list');
  const pick = pane.querySelector('.sl-pick');
  const addBtn = button('Aggiungi', 'btn', () => {
    const slot = Number(pick.value);
    if (!slot) return;
    state.items.push({ slot });
    save();
    render();
  });
  pane.querySelector('.sl-add').append(addBtn);
  const barToggle = button('Barra sopra il mixer', 'toggle', () => {
    state.bar = !state.bar;
    save();
    render();
  });
  const restart = button('Ricomincia dall\'inizio', 'btn ghost', () => {
    state.index = -1;
    save();
    render();
  });
  pane.querySelector('.sl-options').append(barToggle, restart);

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= state.items.length) return;
    [state.items[i], state.items[j]] = [state.items[j], state.items[i]];
    if (state.index === i) state.index = j;
    else if (state.index === j) state.index = i;
    save();
    render();
  };
  const remove = i => {
    state.items.splice(i, 1);
    if (state.index >= i) state.index = Math.max(-1, state.index - 1);
    save();
    render();
  };

  function renderPane() {
    list.innerHTML = '';
    if (!state.items.length) list.append(h('li', 'hint', 'La scaletta è vuota: aggiungi gli snapshot dei brani qui sotto.'));
    state.items.forEach((item, i) => {
      const li = h('li', 'sl-item');
      if (i === state.index) li.classList.add('current');
      li.append(h('span', 'sl-pos', String(i + 1)), h('span', 'sl-name', name(item.slot)));
      const actions = h('span', 'sc-actions');
      const up = button('↑', 'btn ghost', () => move(i, -1), 'Sposta su');
      const down = button('↓', 'btn ghost', () => move(i, 1), 'Sposta giù');
      up.disabled = i === 0;
      down.disabled = i === state.items.length - 1;
      actions.append(up, down, button('✕', 'btn ghost', () => remove(i), 'Togli dalla scaletta'));
      li.append(actions);
      list.append(li);
    });
    const chosen = pick.value;
    pick.innerHTML = '';
    for (let n = 1; n <= SNAPSHOTS.count; n++) {
      if (!scenes.isEmpty(n)) pick.add(new Option(`${pad2(n)} · ${scenes.snapName(n)}`, String(n)));
    }
    if (!pick.options.length) pick.add(new Option('Nessuno snapshot salvato nel mixer', ''));
    if ([...pick.options].some(o => o.value === chosen)) pick.value = chosen;
    addBtn.disabled = !pick.value;
    barToggle.setAttribute('aria-pressed', String(state.bar));
    restart.disabled = state.index < 0;
  }

  function render() {
    renderBar();
    renderPane();
  }
  // i 64 nomi arrivano tutti insieme alla connessione: un solo ridisegno per volta
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  };
  for (let n = 1; n <= SNAPSHOTS.count; n++) mixer.on(SNAPSHOTS.name(n), schedule);
  render();

  return { next, prev, goTo, get state() { return state; } };
}
