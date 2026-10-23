// Layer personalizzati: schede in più nella barra, ognuna con i canali scelti (ingressi, bus, mandate FX,
// DCA) nell'ordine in cui sono stati toccati. Restano su questo dispositivo.

const KEY = 'xair.layers';
const MAX_NAME = 16;

const storage = {
  get() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      return Array.isArray(v) ? v.filter(l => l && l.id && Array.isArray(l.strips)) : [];
    } catch { return []; }
  },
  set(layers) {
    try { localStorage.setItem(KEY, JSON.stringify(layers)); } catch { /* non disponibile */ }
  },
};

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * tabsEl: la barra delle schede; stripsEl: il contenitore delle strip; stripEls: id -> elemento.
 * onSelect(id) mostra il layer (la gestione delle schede resta in app.js).
 */
export function createLayers({ mixer, strips, stripEls, stripsEl, tabsEl, links, onSelect }) {
  const choosable = strips.filter(s => s.group !== 'main'); // il Main LR è sempre visibile a destra
  let layers = storage.get().map(l => ({ ...l, strips: l.strips.filter(id => stripEls.has(id)) }));
  let shown = null;
  const nameOf = s => mixer.get(`${s.base}/config/name`) || s.label;

  // --- schede ---------------------------------------------------------------------------------
  const addTab = h('button', 'tab tab-add', '+ Layer');
  addTab.type = 'button';
  addTab.title = 'Nuovo layer: una pagina con i canali che scegli tu';
  addTab.addEventListener('click', () => edit(null));
  tabsEl.append(addTab);

  function renderTabs() {
    tabsEl.querySelectorAll('.tab-layer').forEach(t => t.remove());
    for (const l of layers) {
      const t = h('button', 'tab tab-layer', l.name);
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.dataset.group = 'layer';
      t.dataset.layer = l.id;
      t.title = 'Tocca di nuovo per modificare il layer';
      // un secondo tocco sulla scheda già aperta apre la modifica
      t.addEventListener('click', () => (shown === l.id && stripsEl.dataset.group === 'layer' ? edit(l) : onSelect(l.id)));
      tabsEl.insertBefore(t, addTab);
    }
  }

  // --- barra del layer aperto -----------------------------------------------------------------
  const bar = h('div', 'layer-bar');
  const barName = h('strong');
  const barEdit = h('button', 'btn ghost', 'Modifica');
  barEdit.type = 'button';
  barEdit.addEventListener('click', () => edit(layers.find(l => l.id === shown)));
  bar.append(barName, barEdit);
  stripsEl.closest('.mixer').before(bar); // sopra il mixer, a tutta larghezza

  function show(id) {
    const layer = layers.find(l => l.id === id);
    shown = layer ? id : null;
    const order = new Map((layer?.strips ?? []).map((sid, i) => [sid, i]));
    for (const [sid, el] of stripEls) {
      el.classList.toggle('in-layer', order.has(sid));
      el.style.order = order.has(sid) ? String(order.get(sid)) : '';
    }
    barName.textContent = layer ? `${layer.name} · ${layer.strips.length} canali` : '';
    return !!layer;
  }

  // --- modifica ------------------------------------------------------------------------------
  const dialog = h('dialog', 'layer-dialog');
  dialog.innerHTML = `
    <form method="dialog">
      <div class="dialog-head"><h2 class="ly-title"></h2></div>
      <label class="ly-label">Nome<input class="ly-name" maxlength="${MAX_NAME}" autocomplete="off"></label>
      <p class="fb-help">Tocca i canali nell'ordine in cui li vuoi vedere. Tocca di nuovo per toglierlo.</p>
      <div class="ly-groups"></div>
      <div class="dialog-actions">
        <button class="btn ghost ly-delete" type="button">Elimina layer</button>
        <span class="spacer"></span>
        <button class="btn ghost ly-cancel" type="button">Annulla</button>
        <button class="btn ly-save" type="submit">Salva</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const $ = s => dialog.querySelector(s);
  let editing = null; // layer modificato (null = nuovo)
  let picked = [];
  const pickButtons = [];
  for (const [title, group] of [['Ingressi', 'input'], ['Bus e mandate FX', 'bus'], ['DCA', 'dca']]) {
    const box = h('div', 'ly-group');
    box.append(h('h3', null, title));
    const row = h('div', 'view-picks');
    for (const s of choosable.filter(x => x.group === group)) {
      const b = h('button', 'toggle ly-pick');
      b.type = 'button';
      b.addEventListener('click', () => {
        picked = picked.includes(s.id) ? picked.filter(x => x !== s.id) : [...picked, s.id];
        renderPicks();
      });
      row.append(b);
      pickButtons.push([s, b]);
    }
    box.append(row);
    $('.ly-groups').append(box);
  }
  function renderPicks() {
    for (const [s, b] of pickButtons) {
      const i = picked.indexOf(s.id);
      b.setAttribute('aria-pressed', String(i >= 0));
      b.textContent = i >= 0 ? `${i + 1}. ${nameOf(s)}` : nameOf(s);
      b.hidden = !!links?.isLinked(s) && !links.isPrimary(s); // il secondo di una coppia stereo segue il primo
    }
    $('.ly-save').disabled = !picked.length;
  }

  function edit(layer) {
    editing = layer;
    picked = layer ? [...layer.strips] : [];
    $('.ly-title').textContent = layer ? `Modifica layer` : 'Nuovo layer';
    $('.ly-name').value = layer?.name ?? `Layer ${layers.length + 1}`;
    $('.ly-delete').hidden = !layer;
    renderPicks();
    dialog.showModal();
  }
  $('.ly-cancel').addEventListener('click', () => dialog.close());
  $('form').addEventListener('submit', e => {
    e.preventDefault();
    if (!picked.length) return;
    const name = $('.ly-name').value.trim().slice(0, MAX_NAME) || `Layer ${layers.length + 1}`;
    if (editing) Object.assign(editing, { name, strips: picked });
    else layers.push(editing = { id: `l${Date.now().toString(36)}`, name, strips: picked });
    storage.set(layers);
    renderTabs();
    dialog.close();
    onSelect(editing.id);
  });
  $('.ly-delete').addEventListener('click', () => {
    layers = layers.filter(l => l !== editing);
    storage.set(layers);
    renderTabs();
    dialog.close();
    if (shown === editing.id) onSelect(null);
  });

  renderTabs();
  return { show, has: id => layers.some(l => l.id === id) };
}
