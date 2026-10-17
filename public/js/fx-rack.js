// Scheda Effetti: i 4 slot FX affiancati, come il rack effetti di X-AIR-Edit.
// Per ogni slot: tipo, parametri, livello e mute del ritorno, master della mandata,
// scorciatoia per regolare le mandate dai canali (sends on fader).

import { Scope, knob, toggle } from './controls.js';
import { ZERO_DB } from './mixer.js';
import { FX_SLOTS } from './fx.js';
import { fxControls } from './fx-ui.js';
import { applyColor } from './ui.js';
import { createFxLibrary } from './fx-library.js';

export const fxInsertAddress = slot => `/fx/${slot}/insert`;

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

export function createFxRack({ mixer, container, onSends, onEditReturn }) {
  const sc = new Scope(mixer);
  const library = createFxLibrary({ mixer, insertAddress: fxInsertAddress });
  const rack = h('div', 'fx-rack');
  const toolbar = h('div', 'fx-toolbar');
  const libBtn = h('button', 'btn', 'Libreria effetti');
  libBtn.type = 'button';
  libBtn.addEventListener('click', () => library.open());
  toolbar.append(h('span', 'fx-note', 'Scegli un effetto dalla libreria e caricalo in uno dei 4 slot.'), libBtn);
  rack.append(toolbar);
  const fader = label => ({ kind: 'fader', label, def: ZERO_DB });

  for (const slot of FX_SLOTS) {
    const card = h('section', 'fx-card');
    const head = h('header', 'fx-card-head');
    const title = h('div', 'fx-card-title');
    const chip = h('span', 'chip');
    const name = h('strong', null, `FX ${slot}`);
    const badge = h('span', 'fx-badge', 'INSERT');
    title.append(chip, name, badge);
    sc.on(`/rtn/${slot}/config/name`, n => { name.textContent = n ? `FX ${slot} · ${n}` : `FX ${slot}`; });
    sc.on(`/rtn/${slot}/config/color`, c => applyColor(title, c));
    // Slot usato come insert su un canale: il ritorno e le mandate non servono.
    sc.on(fxInsertAddress(slot), on => card.classList.toggle('is-insert', !!on));

    const { type, note, grid } = fxControls(mixer, sc, slot);
    const change = h('button', 'btn ghost', 'Cambia…');
    change.type = 'button';
    change.title = 'Scegli dalla libreria effetti';
    change.addEventListener('click', () => library.open(slot));
    const pick = h('div', 'fx-pick');
    pick.append(type, change);
    head.append(title, pick);

    const sends = h('button', 'btn ghost', 'Mandate dai canali');
    sends.type = 'button';
    sends.title = 'I fader dei canali regolano la mandata a questo effetto';
    sends.addEventListener('click', () => onSends(slot));
    const eq = h('button', 'btn ghost', 'EQ ritorno');
    eq.type = 'button';
    eq.addEventListener('click', () => onEditReturn(slot));

    const foot = h('footer', 'fx-card-foot');
    foot.append(
      knob(sc, `/fxsend/${slot}/mix/fader`, fader('Mandata'), { reset: ZERO_DB }),
      knob(sc, `/rtn/${slot}/mix/fader`, fader('Ritorno'), { reset: ZERO_DB }),
      toggle(sc, `/rtn/${slot}/mix/on`, { kind: 'bool', label: 'Ritorno ON', def: 1 }),
      sends,
      eq,
    );
    card.append(head, note, grid, foot);
    rack.append(card);
  }
  container.append(rack);
  return rack;
}
