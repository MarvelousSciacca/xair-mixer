// Libreria effetti: tutti gli effetti del mixer divisi per categoria, con descrizione e ricerca.
// Si sceglie lo slot (FX 1-4) e si carica l'effetto con un tocco.

import { FX_TYPES, FX_CATEGORIES, FX_SLOTS, FX_PARAM_COUNT, fxTypeAddress, fxParamAddress } from './fx.js';
import { ask, notify } from './dialogs.js';

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

const stereoKind = name => (name.startsWith('Dual') ? 'Doppio' : name.startsWith('M/S') ? 'M/S' : 'Stereo');

export function createFxLibrary({ mixer, insertAddress }) {
  const dialog = h('dialog', 'fx-lib');
  dialog.innerHTML = `
    <div class="dialog-head">
      <h2>Libreria effetti</h2>
      <button class="icon-btn lib-close" type="button" aria-label="Chiudi">✕</button>
    </div>
    <div class="lib-slots" role="radiogroup" aria-label="Slot"></div>
    <div class="lib-filters">
      <input class="lib-search" type="search" placeholder="Cerca effetto…" autocomplete="off">
      <div class="lib-cats"></div>
    </div>
    <div class="lib-grid"></div>`;
  document.body.append(dialog);
  const $ = sel => dialog.querySelector(sel);
  $('.lib-close').addEventListener('click', () => dialog.close());

  let slot = 1;
  let category = 'all';
  let search = '';
  const typeOf = n => mixer.get(fxTypeAddress(n), 0);

  // --- slot ---
  const slotButtons = FX_SLOTS.map(n => {
    const b = h('button', 'lib-slot');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      slot = n;
      render();
    });
    $('.lib-slots').append(b);
    return b;
  });

  // --- categorie ---
  const catButtons = [{ id: 'all', label: 'Tutti' }, ...FX_CATEGORIES].map(c => {
    const b = h('button', 'lib-cat', c.label);
    b.type = 'button';
    b.dataset.cat = c.id;
    b.addEventListener('click', () => {
      category = c.id;
      render();
    });
    $('.lib-cats').append(b);
    return b;
  });
  $('.lib-search').addEventListener('input', e => {
    search = e.target.value.trim().toLowerCase();
    render();
  });

  // --- schede degli effetti ---
  const cards = FX_TYPES.map((t, index) => {
    const card = h('button', 'lib-card');
    card.type = 'button';
    const cat = FX_CATEGORIES.find(c => c.id === t.cat)?.label ?? '';
    card.append(
      h('span', 'lib-card-name', t.name),
      h('span', 'lib-card-meta', `${cat} · ${stereoKind(t.name)}`),
      h('span', 'lib-card-desc', t.desc),
      h('span', 'lib-card-where'),
    );
    card.addEventListener('click', () => load(index));
    $('.lib-grid').append(card);
    return { card, t, index };
  });

  function render() {
    slotButtons.forEach((b, i) => {
      const n = FX_SLOTS[i];
      b.setAttribute('aria-checked', String(n === slot));
      b.innerHTML = '';
      b.append(h('strong', null, `FX ${n}`), h('span', null, FX_TYPES[typeOf(n)]?.name ?? '—'));
      b.classList.toggle('insert', !!mixer.get(insertAddress(n), 0));
    });
    catButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === category)));
    for (const { card, t, index } of cards) {
      const visible = (category === 'all' || t.cat === category)
        && (!search || `${t.name} ${t.desc} ${t.code}`.toLowerCase().includes(search));
      card.hidden = !visible;
      const where = FX_SLOTS.filter(n => typeOf(n) === index);
      card.classList.toggle('loaded', where.includes(slot));
      card.querySelector('.lib-card-where').textContent = where.length ? `Caricato in ${where.map(n => `FX ${n}`).join(', ')}` : '';
    }
  }
  for (const n of FX_SLOTS) {
    mixer.on(fxTypeAddress(n), () => { if (dialog.open) render(); });
    mixer.on(insertAddress(n), () => { if (dialog.open) render(); });
  }

  async function load(index) {
    const current = typeOf(slot);
    if (current === index) {
      notify(`${FX_TYPES[index].name} è già nello slot FX ${slot}`);
      return;
    }
    const insert = mixer.get(insertAddress(slot), 0);
    const ok = await ask({
      title: `Caricare ${FX_TYPES[index].name} in FX ${slot}?`,
      message: `Sostituisce ${FX_TYPES[current]?.name ?? 'l\'effetto attuale'}: i parametri tornano ai valori predefiniti dell'effetto.`
        + (insert ? '\nAttenzione: questo slot è usato come insert su un canale.' : ''),
      confirmText: 'Carica',
    });
    if (!ok) return;
    mixer.set(fxTypeAddress(slot), index, 'i');
    setTimeout(() => mixer.query(Array.from({ length: FX_PARAM_COUNT }, (_, i) => fxParamAddress(slot, i)), { priority: true }), 300);
    notify(`${FX_TYPES[index].name} caricato in FX ${slot}`);
    render();
  }

  return {
    open(n = slot) {
      slot = n;
      render();
      dialog.showModal();
    },
  };
}
