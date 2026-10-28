// Snapshot salvati nel mixer (carica, salva, rinomina, elimina) e scene su file
// (tutto il mix salvato sul dispositivo e ricaricabile anche su un altro mixer X Air).

import { SNAPSHOTS } from './model.js';
import { ask, notify } from './dialogs.js';
import { createSafes, protectable } from './safes.js';

const pad2 = n => String(n).padStart(2, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SCENE_FORMAT = 'xair-mixer-scene';

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/** Fotografia di tutti i parametri noti, pronta da salvare su file. */
export function captureScene(mixer, addresses, name) {
  const params = {};
  for (const address of addresses) {
    if (address.startsWith('/-')) continue; // stato (solo, RTA, snapshot): non fa parte del mix
    const value = mixer.get(address);
    if (value === undefined || value === null || Number.isNaN(value)) continue;
    const type = mixer.typeOf(address) ?? (typeof value === 'string' ? 's' : Number.isInteger(value) ? 'i' : 'f');
    params[address] = [type, value];
  }
  return { format: SCENE_FORMAT, version: 1, name, created: new Date().toISOString(), mixer: mixer.info, params };
}

const MAX_SCENE_BYTES = 2 * 1024 * 1024;

/**
 * Tiene di una scena letta da file solo i parametri che l'app conosce, con valori validi:
 * un file scambiato con altri non può mandare al mixer comandi o valori fuori scala.
 */
export function sanitizeScene(scene, addresses) {
  if (!scene || scene.format !== SCENE_FORMAT || typeof scene.params !== 'object' || !scene.params) return null;
  const known = new Set(addresses);
  const params = {};
  for (const [address, entry] of Object.entries(scene.params)) {
    if (!known.has(address) || address.startsWith('/-') || !Array.isArray(entry) || entry.length !== 2) continue;
    const [type, value] = entry;
    const ok = (type === 'f' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
      || (type === 'i' && Number.isInteger(value) && value >= 0 && value <= 0xffff)
      || (type === 's' && typeof value === 'string' && value.length <= 32);
    if (ok) params[address] = [type, value];
  }
  const name = typeof scene.name === 'string' ? scene.name.slice(0, 64) : 'Scena';
  const model = typeof scene.mixer?.model === 'string' ? scene.mixer.model.slice(0, 16) : null;
  return { ...scene, name, mixer: model ? { model } : null, params };
}

/** Scarica la scena come file .json. */
export function downloadScene(scene) {
  const blob = new Blob([JSON.stringify(scene, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${scene.name.replace(/[^\w\- ]+/g, '').trim() || 'scena'}.xair.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function createScenes({ mixer, addresses, strips, onReload, offline = null }) {
  const safes = createSafes(protectable(strips));
  const dialog = h('dialog', 'scenes-dialog');
  dialog.innerHTML = `
    <div class="dialog-head">
      <h2>Scene e snapshot</h2>
      <button class="icon-btn sc-close" type="button" aria-label="Chiudi">✕</button>
    </div>
    <nav class="tabs sc-tabs">
      <button class="tab" type="button" data-tab="snap">Snapshot nel mixer</button>
      <button class="tab" type="button" data-tab="file">Scene su file</button>
      <button class="tab" type="button" data-tab="setlist">Scaletta</button>
      <button class="tab" type="button" data-tab="safe">Canali protetti</button>
    </nav>
    <p class="sc-safe-note" hidden></p>
    <section class="sc-pane" data-pane="snap">
      <p class="sc-current"></p>
      <ul class="sc-list"></ul>
    </section>
    <section class="sc-pane" data-pane="file" hidden>
      <p class="fb-help">Una scena su file contiene tutto il mix (canali, EQ, dinamiche, mandate, effetti, DCA, patch).
        Si salva su questo dispositivo e si può ricaricare in qualsiasi momento, anche su un altro mixer X Air.</p>
      <div class="ed-row">
        <button class="btn sc-save-file" type="button">Salva scena su file</button>
        <button class="btn ghost sc-load-file" type="button">Carica scena da file</button>
        <input class="sc-file" type="file" accept=".json,application/json" hidden>
      </div>
      <div class="sc-progress" hidden><div class="sc-bar"></div><span></span></div>
      <div class="sc-offline" hidden>
        <h3>Lavoro senza mixer</h3>
        <p class="fb-help sc-offline-help"></p>
        <div class="ed-row">
          <button class="btn sc-send-work" type="button">Invia al mixer</button>
          <button class="btn ghost sc-save-work" type="button">Salva su file</button>
          <button class="btn ghost sc-reset-work" type="button">Ricomincia</button>
        </div>
      </div>
    </section>
    <section class="sc-pane sc-setlist" data-pane="setlist" hidden></section>
    <section class="sc-pane" data-pane="safe" hidden>
      <p class="fb-help">I canali protetti non cambiano quando carichi uno snapshot o una scena su file.
        Proteggendo un bus o una mandata FX resta com'è anche quanto ogni canale gli manda: utile per i monitor.</p>
      <div class="sc-safe-groups"></div>
    </section>`;
  document.body.append(dialog);
  const $ = sel => dialog.querySelector(sel);

  // --- schede ---
  const showPane = id => {
    dialog.querySelectorAll('.sc-tabs .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    dialog.querySelectorAll('.sc-pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
  };
  dialog.querySelectorAll('.sc-tabs .tab').forEach(t => t.addEventListener('click', () => showPane(t.dataset.tab)));
  $('.sc-close').addEventListener('click', () => dialog.close());

  // --- canali protetti ---
  const nameOf = st => mixer.get(`${st.base}/config/name`) || st.label;
  const safeButtons = [];
  const groups = [['Ingressi', 'input'], ['Bus e mandate FX', 'bus'], ['Main', 'main']];
  for (const [title, group] of groups) {
    const box = h('div', 'sc-safe-group');
    box.append(h('h3', null, title));
    const row = h('div', 'view-picks');
    for (const st of protectable(strips).filter(x => x.group === group)) {
      const b = h('button', 'toggle', st.label);
      b.type = 'button';
      b.addEventListener('click', () => safes.toggle(st.id));
      mixer.on(`${st.base}/config/name`, () => { b.textContent = nameOf(st); renderSafes(); });
      row.append(b);
      safeButtons.push([st, b]);
    }
    box.append(row);
    $('.sc-safe-groups').append(box);
  }
  function renderSafes() {
    for (const [st, b] of safeButtons) b.setAttribute('aria-pressed', String(safes.has(st.id)));
    const names = safeButtons.filter(([st]) => safes.has(st.id)).map(([st]) => nameOf(st));
    const note = $('.sc-safe-note');
    note.hidden = !names.length;
    note.textContent = `Protetti: ${names.join(', ')}`;
    dialog.querySelector('[data-tab="safe"]').textContent = names.length ? `Canali protetti (${names.length})` : 'Canali protetti';
  }
  safes.onChange(renderSafes);
  renderSafes();

  /** Parametri protetti con il loro valore attuale, da rimettere dopo uno snapshot. */
  const protectedEntries = () => safes.filter(addresses)
    .filter(a => !a.startsWith('/-') && mixer.get(a) !== undefined)
    .map(address => ({ address, value: mixer.get(address), type: mixer.typeOf(address) ?? 'f' }))
    // prima ciò che si sente di più: accensione, fader, mandate
    .sort((a, b) => Number(!/\/mix\//.test(a.address)) - Number(!/\/mix\//.test(b.address)));

  // --- snapshot nel mixer ---
  const list = $('.sc-list');
  const rows = [];
  for (let n = 1; n <= SNAPSHOTS.count; n++) {
    const li = h('li', 'sc-row');
    const num = h('span', 'sc-num', pad2(n));
    const name = h('span', 'sc-name');
    const actions = h('span', 'sc-actions');
    const button = (text, cls, fn) => {
      const b = h('button', cls, text);
      b.type = 'button';
      b.addEventListener('click', fn);
      actions.append(b);
      return b;
    };
    const load = button('Carica', 'btn', () => loadSnapshot(n));
    button('Salva qui', 'btn ghost', () => saveSnapshot(n));
    const rename = button('Rinomina', 'btn ghost', () => renameSnapshot(n));
    const del = button('Elimina', 'btn ghost', () => deleteSnapshot(n));
    li.append(num, name, actions);
    list.append(li);
    rows.push({ li, name, load, rename, del });
    mixer.on(SNAPSHOTS.name(n), () => renderRow(n));
  }
  const snapName = n => mixer.get(SNAPSHOTS.name(n), '');
  const isEmpty = n => !snapName(n);
  function renderRow(n) {
    const r = rows[n - 1];
    const empty = isEmpty(n);
    r.name.textContent = empty ? '— vuoto —' : snapName(n);
    r.li.classList.toggle('empty', empty);
    r.li.classList.toggle('current', mixer.get(SNAPSHOTS.index) === n);
    r.load.disabled = r.rename.disabled = r.del.disabled = empty;
  }
  const renderCurrent = () => {
    const index = mixer.get(SNAPSHOTS.index);
    const current = mixer.get(SNAPSHOTS.current, '');
    $('.sc-current').textContent = index ? `Ultimo snapshot caricato: ${pad2(index)} · ${current || snapName(index)}` : '';
    for (let n = 1; n <= SNAPSHOTS.count; n++) renderRow(n);
  };
  mixer.on(SNAPSHOTS.index, renderCurrent);
  mixer.on(SNAPSHOTS.current, renderCurrent);

  const refreshSnapshots = () => mixer.query([SNAPSHOTS.index, SNAPSHOTS.current,
    ...Array.from({ length: SNAPSHOTS.count }, (_, i) => SNAPSHOTS.name(i + 1))], { priority: true });

  /** Carica uno snapshot; confirm: false per la scaletta dal vivo (nessuna domanda, subito). */
  async function loadSnapshot(n, { confirm = true } = {}) {
    const ok = !confirm || await ask({
      title: `Caricare lo snapshot ${pad2(n)}?`,
      message: `"${snapName(n)}" sostituirà il mix attuale. Se vuoi conservarlo, salvalo prima in uno snapshot o su file.`,
      confirmText: 'Carica',
      danger: true,
    });
    if (!ok) return;
    // lo snapshot lo carica il mixer per intero: i canali protetti si rimettono subito dopo
    const keep = protectedEntries();
    mixer.command(SNAPSHOTS.load, [{ type: 'i', value: n }]);
    mixer.clearHistory(); // Annulla non deve mescolare la scena nuova con quella di prima
    const restored = keep.length ? mixer.setMany(keep) : null;
    notify(`Caricamento di "${snapName(n)}"…${keep.length ? ' I canali protetti restano com\'erano.' : ''}`);
    await sleep(800);
    await restored;
    onReload(); // il mixer ha cambiato tutto: rilegge i parametri
    refreshSnapshots();
  }

  async function saveSnapshot(n) {
    const name = await ask({
      title: `Salvare il mix nello snapshot ${pad2(n)}`,
      message: isEmpty(n) ? 'Nome dello snapshot:' : `Sovrascrive "${snapName(n)}". Nome dello snapshot:`,
      input: isEmpty(n) ? `Snapshot ${n}` : snapName(n),
      confirmText: isEmpty(n) ? 'Salva' : 'Sovrascrivi',
      danger: !isEmpty(n),
    });
    if (!name) return;
    mixer.command(SNAPSHOTS.save, [{ type: 'i', value: n }]);
    await sleep(400);
    mixer.set(SNAPSHOTS.name(n), name, 's');
    await sleep(400);
    refreshSnapshots();
    notify(`Snapshot ${pad2(n)} salvato`);
  }

  async function renameSnapshot(n) {
    const name = await ask({ title: `Rinomina snapshot ${pad2(n)}`, input: snapName(n), confirmText: 'Rinomina' });
    if (name) mixer.set(SNAPSHOTS.name(n), name, 's');
  }

  async function deleteSnapshot(n) {
    const ok = await ask({ title: `Eliminare lo snapshot ${pad2(n)}?`, message: `"${snapName(n)}" verrà cancellato dal mixer.`, confirmText: 'Elimina', danger: true });
    if (!ok) return;
    mixer.command(SNAPSHOTS.delete, [{ type: 'i', value: n }]);
    await sleep(400);
    refreshSnapshots();
  }

  // --- scene su file ---
  const progress = $('.sc-progress');
  const setProgress = (done, total) => {
    progress.hidden = false;
    $('.sc-bar').style.width = `${(100 * done) / total}%`;
    progress.querySelector('span').textContent = `${done} / ${total} parametri`;
  };

  $('.sc-save-file').addEventListener('click', async () => {
    const name = await ask({ title: 'Salva scena su file', message: 'Nome della scena:', input: mixer.get(SNAPSHOTS.current, '') || 'Scena', confirmText: 'Salva' });
    if (!name) return;
    const scene = captureScene(mixer, addresses, name);
    downloadScene(scene);
    notify(`Scena "${name}" salvata (${Object.keys(scene.params).length} parametri)`);
  });

  const fileInput = $('.sc-file');
  $('.sc-load-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let scene = null;
    try {
      if (file.size <= MAX_SCENE_BYTES) scene = sanitizeScene(JSON.parse(await file.text()), addresses);
    } catch { /* non è JSON */ }
    if (!scene || !Object.keys(scene.params).length) {
      notify('Il file non è una scena di AirDesk', { error: true });
      return;
    }
    await confirmAndApply(scene);
  });

  /** Chiede conferma (avvisando se la scena accende la +48V) e carica la scena. */
  async function confirmAndApply(scene) {
    const count = Object.keys(scene.params).length;
    const otherModel = scene.mixer?.model && mixer.info?.model && scene.mixer.model !== mixer.info.model;
    // la +48V accesa per sbaglio può danneggiare microfoni a nastro e alcune sorgenti di linea
    const phantomOn = Object.entries(scene.params)
      .filter(([a, [, v]]) => /^\/headamp\/\d\d\/phantom$/.test(a) && v && !mixer.get(a))
      .map(([a]) => `In ${Number(a.split('/')[2])}`);
    const ok = await ask({
      title: `Caricare "${scene.name}"?`,
      message: `${count} parametri sostituiranno il mix attuale.${otherModel ? ` Attenzione: la scena è stata salvata da un ${scene.mixer.model}.` : ''}`
        + (phantomOn.length ? `\n\nAttenzione: la scena accende la +48V su ${phantomOn.join(', ')}. Controlla che lì non ci siano microfoni a nastro o sorgenti che la phantom può danneggiare.` : ''),
      confirmText: 'Carica',
      danger: true,
    });
    if (!ok) return false;
    await applyScene(scene, setProgress);
    progress.hidden = true;
    notify(`Scena "${scene.name}" caricata`);
    return true;
  }

  // --- lavoro senza mixer ---
  const workScene = () => sanitizeScene({ format: SCENE_FORMAT, version: 1, name: 'Lavoro senza mixer', params: offline.work() }, addresses);
  function renderOffline() {
    const box = $('.sc-offline');
    box.hidden = !offline || (!offline.active() && !offline.hasWork);
    if (box.hidden) return;
    $('.sc-offline-help').textContent = offline.active()
      ? 'Stai lavorando senza mixer: le modifiche restano su questo dispositivo. Quando ti colleghi al mixer, torna qui e tocca "Invia al mixer".'
      : 'Il mix preparato senza mixer è salvato su questo dispositivo. "Invia al mixer" lo carica nel mixer collegato, come una scena (i canali protetti non cambiano).';
    $('.sc-send-work').disabled = offline.active() || mixer.status !== 'online';
  }
  if (offline) {
    mixer.onStatus(renderOffline);
    $('.sc-send-work').addEventListener('click', async () => {
      const scene = workScene();
      if (scene && await confirmAndApply(scene)) renderOffline();
    });
    $('.sc-save-work').addEventListener('click', () => downloadScene(workScene()));
    $('.sc-reset-work').addEventListener('click', async () => {
      const ok = await ask({
        title: 'Ricominciare il lavoro senza mixer?',
        message: 'Il mix preparato senza mixer verrà sostituito dall\'ultimo mix visto sul mixer. Se vuoi conservarlo, salvalo prima su file.',
        confirmText: 'Ricomincia',
        danger: true,
      });
      if (!ok) return;
      offline.reset();
      if (offline.active()) onReload();
      renderOffline();
    });
  }

  async function applyScene(scene, onProgress) {
    const skip = new Set(safes.filter(Object.keys(scene.params))); // canali protetti: non si toccano
    const entries = Object.entries(scene.params)
      .filter(([address]) => !address.startsWith('/-') && !skip.has(address))
      .map(([address, [type, value]]) => ({ address, type, value }));
    // Prima i tipi di effetto (il mixer reimposta i parametri dell'effetto quando cambia tipo).
    const isFxType = e => /^\/fx\/\d\/type$/.test(e.address);
    await mixer.setMany(entries.filter(isFxType));
    await sleep(600);
    await mixer.setMany(entries.filter(e => !isFxType(e)), onProgress);
  }

  return {
    open(tab = 'snap') {
      refreshSnapshots();
      renderOffline();
      showPane(tab);
      dialog.showModal();
    },
    applyScene,
    loadSnapshot,
    snapName,
    isEmpty,
    setlistPane: $('.sc-setlist'),
  };
}
