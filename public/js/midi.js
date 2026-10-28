// Controller MIDI (Web MIDI: app per computer e browser Chrome/Edge; non c'è su iPhone/iPad).
// "Impara": si muove un comando nell'app, poi il controllo sul controller, e restano collegati.
// Manopole e fader (CC) muovono i parametri continui; tasti (note, CC, program change) accendono e
// spengono i parametri on/off o eseguono un'azione (es. brano successivo della scaletta).

import { notify } from './dialogs.js';

const KEY = 'xair.midi';

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/** Messaggio MIDI -> { key, value (0..127), press } o null se non interessa. */
export function parseMidi(data) {
  const [status, a = 0, b = 0] = data;
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  if (type === 0xb0) return { key: `cc:${ch}:${a}`, value: b, press: b > 0, continuous: true };
  if (type === 0x90 && b > 0) return { key: `note:${ch}:${a}`, value: b, press: true };
  if (type === 0x90 || type === 0x80) return { key: `note:${ch}:${a}`, value: 0, press: false };
  if (type === 0xc0) return { key: `pc:${ch}:${a}`, value: 127, press: true };
  return null;
}

export const describeKey = key => {
  const [kind, ch, n] = key.split(':');
  return `${{ cc: 'CC', note: 'Nota', pc: 'Program' }[kind]} ${n} · canale ${ch}`;
};

/**
 * actions: { id: { label, run } } azioni assegnabili (bottoni con data-midi-action).
 * describe(address) -> testo leggibile del parametro.
 */
export function createMidi({ mixer, storage, actions = {}, describe = a => a }) {
  let state = { enabled: false, map: {} };
  try {
    const d = JSON.parse(storage.get(KEY) ?? 'null');
    if (d && typeof d.map === 'object') state = { enabled: !!d.enabled, map: d.map };
  } catch { /* impostazioni non valide */ }
  const save = () => storage.set(KEY, JSON.stringify(state));
  const listeners = new Set();
  const emit = () => listeners.forEach(cb => cb());

  const supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  let access = null;
  let learning = null; // { target } mentre si impara
  const lastSeen = new Map(); // key -> { value, at } (per i tasti che mandano 127 e poi 0)
  const REPRESS_MS = 400; // tasti che mandano solo 127: un nuovo 127 dopo una pausa vale come nuova pressione

  // --- ricezione -----------------------------------------------------------------------------
  function receive(e) {
    const msg = parseMidi(e.data);
    if (!msg) return;
    if (learning) {
      if (!learning.target || !msg.press) return;
      state.map[msg.key] = learning.target;
      save();
      notify(`Collegato: ${describeKey(msg.key)} → ${label(learning.target)}`);
      stopLearn();
      emit(); // l'elenco dei collegamenti nelle impostazioni si aggiorna
      return;
    }
    const target = state.map[msg.key];
    if (!target) return;
    if (target.action) {
      if (msg.press) actions[target.action]?.run();
      return;
    }
    if (target.type === 'f' && msg.continuous) {
      mixer.set(target.address, msg.value / 127, 'f');
    } else {
      // tasto: inverte acceso/spento sulla pressione (non sul rilascio, né ripetendo un CC già alto)
      const prev = lastSeen.get(msg.key);
      const fresh = !msg.continuous || !prev || prev.value === 0 || e.timeStamp - prev.at > REPRESS_MS;
      if (msg.press && fresh) mixer.set(target.address, mixer.get(target.address, 0) ? 0 : 1, 'i');
    }
    lastSeen.set(msg.key, { value: msg.value, at: e.timeStamp ?? 0 });
  }

  function attachInputs() {
    if (!access) return;
    for (const input of access.inputs.values()) input.onmidimessage = state.enabled ? receive : null;
    emit();
  }

  async function enable(on) {
    state.enabled = on;
    save();
    if (on && supported && !access) {
      try {
        access = await navigator.requestMIDIAccess({ sysex: false });
        access.onstatechange = attachInputs; // controller collegati o scollegati dopo
      } catch {
        notify('Il MIDI non è stato concesso su questo dispositivo', { error: true });
        state.enabled = false;
        save();
      }
    }
    attachInputs();
    emit();
  }

  // --- impara -------------------------------------------------------------------------------
  const banner = h('div', 'midi-learn');
  banner.hidden = true;
  const bannerText = h('span');
  const cancel = h('button', 'btn ghost', 'Annulla');
  cancel.type = 'button';
  cancel.addEventListener('click', () => stopLearn());
  banner.append(bannerText, cancel);
  document.body.append(banner);

  const label = target => (target.action ? actions[target.action]?.label ?? target.action : describe(target.address));
  const renderBanner = () => {
    banner.hidden = !learning;
    if (!learning) return;
    bannerText.textContent = learning.target
      ? `${label(learning.target)}: ora muovi o premi il controllo MIDI`
      : 'Impara MIDI: muovi un comando nell\'app (fader, manopola, mute…) o tocca un pulsante della scaletta';
  };

  mixer.onUserSet((address, value, type) => {
    if (!learning) return;
    learning.target = { address, type: type === 's' ? null : type };
    if (!learning.target.type) learning.target = null; // i testi (nomi) non si comandano col MIDI
    renderBanner();
  });
  document.addEventListener('click', e => {
    const id = learning && e.target.closest?.('[data-midi-action]')?.dataset.midiAction;
    if (!id || !actions[id]) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // mentre si impara il pulsante non esegue l'azione
    learning.target = { action: id };
    renderBanner();
  }, true);

  function startLearn() {
    learning = { target: null };
    renderBanner();
  }
  function stopLearn() {
    learning = null;
    renderBanner();
  }

  if (state.enabled && supported) enable(true);

  return {
    supported,
    get enabled() { return state.enabled; },
    get inputs() { return access ? [...access.inputs.values()].map(i => i.name) : []; },
    get mappings() { return Object.entries(state.map).map(([key, target]) => ({ key, text: `${describeKey(key)} → ${label(target)}` })); },
    get learning() { return !!learning; },
    enable,
    startLearn,
    stopLearn,
    remove(key) {
      delete state.map[key];
      save();
      emit();
    },
    clear() {
      state.map = {};
      save();
      emit();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    receive, // per le prove
  };
}
