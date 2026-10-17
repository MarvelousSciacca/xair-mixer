// Modalità monitor (in-ear): una schermata dedicata a un solo bus.
// Si scelgono i canali da vedere; i loro fader regolano solo le mandate verso quel bus,
// quindi non cambiano il mix di sala. Si può bloccare la schermata (uscita tenendo premuto).
// Apertura diretta da link: ?monitor=2 (bus 2), aggiungendo &lock=1 la schermata parte bloccata.

import { createStrip } from './ui.js';

const PREF_KEY = 'xair.monitor';
const HOLD_MS = 1500;

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/** Pulsante che agisce solo se tenuto premuto (usato quando la schermata è bloccata). */
function holdable(btn, needsHold, action) {
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    btn.classList.remove('holding');
  };
  btn.addEventListener('pointerdown', () => {
    if (!needsHold()) return;
    btn.classList.add('holding');
    timer = setTimeout(() => {
      cancel();
      action();
    }, HOLD_MS);
  });
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('click', () => {
    if (!needsHold()) action();
  });
}

export function createMonitor({ mixer, strips, links, editor, storage }) {
  const inputs = strips.filter(s => s.group === 'input' && s.sends);
  const buses = strips.filter(s => s.id.startsWith('bus'));

  let settings = { active: false, bus: 1, locked: false, channels: {} };
  try {
    settings = { ...settings, ...JSON.parse(storage.get(PREF_KEY) ?? '{}') };
  } catch { /* impostazioni non valide */ }
  const params = new URLSearchParams(location.search);
  if (params.has('monitor')) {
    settings.active = true;
    settings.bus = Math.min(6, Math.max(1, Number(params.get('monitor')) || 1));
    settings.locked = params.get('lock') === '1';
  }
  const save = () => storage.set(PREF_KEY, JSON.stringify(settings));

  // --- struttura -------------------------------------------------------------------------
  const root = h('div', 'monitor-view');
  root.hidden = true;
  root.innerHTML = `
    <header class="topbar monitor-head">
      <div class="brand">In-ear <span>Monitor</span></div>
      <select class="mon-bus" aria-label="Bus monitor"></select>
      <button class="btn ghost mon-pick" type="button">Canali</button>
      <div class="spacer"></div>
      <button class="toggle mon-lock" type="button">Blocca</button>
      <button class="btn mon-exit" type="button">Esci</button>
    </header>
    <div class="mon-hint"></div>
    <main class="mixer mon-body">
      <div class="strips mon-strips"></div>
      <div class="main-strip mon-master"></div>
    </main>`;
  document.body.append(root);
  const $ = sel => root.querySelector(sel);
  const busSelect = $('.mon-bus');
  const hint = $('.mon-hint');

  // Le strip vengono create una volta sola; cambiando bus o canali si mostrano/nascondono.
  const noop = () => {};
  const inputEls = new Map(inputs.map(s => {
    const el = createStrip(mixer, s, { onEdit: noop, onProcess: noop, editable: false, links });
    $('.mon-strips').append(el);
    return [s.id, el];
  }));
  const busEls = new Map(buses.map(s => {
    const el = createStrip(mixer, s, { onEdit: noop, onProcess: editor.open, editable: true, links });
    $('.mon-master').append(el);
    return [s.id, el];
  }));

  for (const b of buses) {
    const n = Number(b.id.slice(3));
    const option = new Option(b.label, n);
    busSelect.add(option);
    mixer.on(`${b.base}/config/name`, name => {
      option.text = name || b.label;
      if (Number(busSelect.value) === n) renderHint();
    });
  }

  const busName = n => busSelect.options[n - 1]?.text ?? `Bus ${n}`;
  const selected = n => settings.channels[n] ?? inputs.map(s => s.id);

  function renderHint() {
    hint.textContent = settings.locked
      ? `Mix di ${busName(settings.bus)} · schermata bloccata (tieni premuto per sbloccare)`
      : `I fader regolano solo il mix di ${busName(settings.bus)}: l'audio in sala non cambia.`;
  }

  function render() {
    const n = links.primaryBus(settings.bus);
    busSelect.value = String(n);
    const show = new Set(selected(n));
    for (const [id, el] of inputEls) {
      el.setSend(n);
      el.hidden = !show.has(id);
    }
    for (const [id, el] of busEls) el.hidden = id !== `bus${n}`;
    root.classList.toggle('locked', settings.locked);
    $('.mon-lock').setAttribute('aria-pressed', String(settings.locked));
    $('.mon-lock').textContent = settings.locked ? 'Bloccato' : 'Blocca';
    renderHint();
  }
  links.onChange(() => { if (!root.hidden) render(); });

  // --- scelta dei canali -----------------------------------------------------------------------
  const picker = h('dialog', 'mon-picker');
  picker.innerHTML = `
    <h2>Canali nel mix</h2>
    <div class="mon-picks"></div>
    <div class="dialog-actions">
      <button class="btn ghost mon-all" type="button">Tutti</button>
      <button class="btn ghost mon-none" type="button">Nessuno</button>
      <button class="btn mon-done" type="button">Fatto</button>
    </div>`;
  document.body.append(picker);
  const picks = picker.querySelector('.mon-picks');
  const pickButtons = inputs.map(s => {
    const b = h('button', 'toggle', s.label);
    b.type = 'button';
    mixer.on(`${s.base}/config/name`, name => { b.textContent = name || s.label; });
    b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')));
    picks.append(b);
    return { s, b };
  });
  const openPicker = () => {
    const show = new Set(selected(links.primaryBus(settings.bus)));
    for (const { s, b } of pickButtons) {
      b.hidden = links.isLinked(s) && !links.isPrimary(s);
      b.setAttribute('aria-pressed', String(show.has(s.id)));
    }
    picker.showModal();
  };
  picker.querySelector('.mon-all').addEventListener('click', () => pickButtons.forEach(({ b }) => b.setAttribute('aria-pressed', 'true')));
  picker.querySelector('.mon-none').addEventListener('click', () => pickButtons.forEach(({ b }) => b.setAttribute('aria-pressed', 'false')));
  picker.querySelector('.mon-done').addEventListener('click', () => {
    settings.channels[links.primaryBus(settings.bus)] = pickButtons.filter(({ b }) => b.getAttribute('aria-pressed') === 'true').map(({ s }) => s.id);
    save();
    render();
    picker.close();
  });

  // --- comandi ---------------------------------------------------------------------------------
  busSelect.addEventListener('change', () => {
    settings.bus = Number(busSelect.value);
    save();
    render();
  });
  $('.mon-pick').addEventListener('click', openPicker);
  holdable($('.mon-lock'), () => settings.locked, () => {
    settings.locked = !settings.locked;
    save();
    render();
  });
  holdable($('.mon-exit'), () => settings.locked, () => exit());

  function enter(bus = settings.bus) {
    settings.active = true;
    settings.bus = bus;
    save();
    root.hidden = false;
    document.body.classList.add('monitor-mode');
    render();
  }

  function exit() {
    settings.active = false;
    settings.locked = false;
    save();
    root.hidden = true;
    document.body.classList.remove('monitor-mode');
  }

  if (settings.active) enter();
  return { enter, exit };
}
