// Vista del mixer: cosa mostrare sulle channel strip (sezioni, pan), altezza dei fader e larghezza
// dei canali. Le preferenze restano su questo dispositivo. La densità delle sezioni (piena,
// compatta, mini) si adatta da sola all'altezza dello schermo.

import { SECTIONS, SECTION_HEIGHT, MINI_ROW } from './strip-sections.js';

const KEY = 'xair.view';
const DEFAULTS = {
  sections: { preamp: true, gate: true, dyn: true, eq: true, sends: false },
  pan: true,
  fader: 'normal', // 'normal' | 'short'
  width: 'normal', // 'narrow' | 'normal' | 'wide'
  hidden: [], // canali nascosti nella scheda Ingressi del mixer principale
};
const WIDTHS = { narrow: 0.85, normal: 1, wide: 1.25 }; // scala della larghezza base (che cambia col dispositivo)
// spazio fisso della strip senza sezioni né fader: nome, tasti G/C/EQ, pan, valore, solo/mute, etichetta
const FIXED = 34 + 22 + 28 + 20 + 30 + 14 + 6 * 7 + 12;
const FADER_MIN = { normal: 230, short: 130 };

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...v, sections: { ...DEFAULTS.sections, ...(v.sections ?? {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function createView({ mixerEl, stripsEl }) {
  let view = load();
  const listeners = new Set();
  // superfici che seguono la Vista: il mixer principale e, se aperta, la modalità monitor
  const surfaces = [];
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(view)); } catch { /* non disponibile */ }
  };

  /** Densità più ricca che lascia al fader almeno l'altezza minima. */
  const density = strips => {
    const h = strips.clientHeight || window.innerHeight;
    const shown = SECTIONS.filter(s => view.sections[s.id]).map(s => s.id);
    const need = d => shown.reduce((sum, id) => sum + SECTION_HEIGHT[d][id] + 4, 0)
      + (d === 'mini' && shown.some(id => ['gate', 'dyn', 'eq'].includes(id)) ? MINI_ROW : 0);
    return ['full', 'compact', 'mini'].find(d => FIXED + need(d) + FADER_MIN[view.fader] <= h) ?? 'mini';
  };

  const apply = () => {
    const shown = Object.entries(view.sections).filter(([, on]) => on).map(([id]) => id);
    if (view.pan) shown.push('pan');
    document.body.dataset.show = shown.join(' ');
    for (const s of surfaces) {
      s.mixerEl.dataset.show = shown.join(' ');
      s.mixerEl.dataset.fader = view.fader;
      s.mixerEl.dataset.density = density(s.stripsEl);
    }
    document.documentElement.style.setProperty('--strip-scale', String(WIDTHS[view.width]));
    // canali scelti: valgono solo per il mixer principale (il monitor ha la sua scelta per bus)
    const hidden = new Set(view.hidden);
    for (const el of stripsEl.querySelectorAll('.strip[data-id]')) el.classList.toggle('user-hidden', hidden.has(el.dataset.id));
    // la riga G/C/EQ sparisce se tutte le sue sezioni sono già visibili come miniature
    for (const proc of document.querySelectorAll('.mixer .proc')) {
      const tabs = [...proc.querySelectorAll('.proc-btn')].map(b => b.dataset.tab);
      proc.classList.toggle('all-hidden', tabs.every(t => view.sections[t]));
    }
    listeners.forEach(cb => cb(view));
    requestAnimationFrame(() => alignFaders());
  };

  const refreshDensity = () => surfaces.forEach(s => {
    const d = density(s.stripsEl);
    if (s.mixerEl.dataset.density !== d) s.mixerEl.dataset.density = d;
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refreshDensity) : null;
  window.addEventListener('resize', () => { refreshDensity(); requestAnimationFrame(() => alignFaders()); });
  const attach = (m, s) => {
    surfaces.push({ mixerEl: m, stripsEl: s });
    observer?.observe(s);
    apply();
  };
  attach(mixerEl, stripsEl);

  return {
    attach,
    get: () => view,
    set(patch) {
      view = { ...view, ...patch, sections: { ...view.sections, ...(patch.sections ?? {}) } };
      save();
      apply();
    },
    reset() {
      view = structuredClone(DEFAULTS);
      save();
      apply();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * Allinea i fader delle strip visibili: le strip senza sezioni o senza pan (mandate FX, DCA)
 * avrebbero il fader più in alto delle altre. Si aggiunge lo spazio mancante sopra il fader.
 */
export function alignFaders(root = document) {
  for (const mixer of root.querySelectorAll('.mixer')) {
    const areas = [...mixer.querySelectorAll('.strip .fader-area')].filter(a => a.offsetParent);
    areas.forEach(a => { a.style.marginTop = ''; });
    if (areas.length < 2) continue;
    const tops = areas.map(a => a.getBoundingClientRect().top);
    const max = Math.max(...tops);
    areas.forEach((a, i) => { if (max - tops[i] > 1) a.style.marginTop = `${max - tops[i]}px`; });
  }
}

/**
 * Pannello "Vista": interruttori per sezioni e pan, scelta di fader e larghezza.
 * channels: canali della scheda Ingressi che si possono nascondere ({ id, label, base });
 * la scelta compare solo aprendo il pannello dal mixer principale (open({ channels: true })).
 */
export function createViewPanel(view, { channels = [], mixer = null, links = null } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'view-dialog';
  dialog.innerHTML = `
    <div class="dialog-head"><h2>Vista</h2><button class="icon-btn view-close" type="button" aria-label="Chiudi">✕</button></div>
    <p class="view-help">Scegli cosa mostrare su ogni canale. Se lo spazio non basta, le sezioni si compattano da sole.</p>
    <div class="view-group view-channels"><h3>Canali in Ingressi</h3><div class="mon-picks view-picks"></div>
      <div class="view-picks-actions"><button class="btn ghost view-all" type="button">Tutti</button><button class="btn ghost view-none" type="button">Nessuno</button></div></div>
    <div class="view-group"><h3>Sezioni dei canali</h3><div class="view-toggles"></div></div>
    <div class="view-group"><h3>Fader</h3><div class="segmented view-fader"></div></div>
    <div class="view-group"><h3>Larghezza canali</h3><div class="segmented view-width"></div></div>
    <div class="dialog-actions"><button class="btn ghost view-reset" type="button">Ripristina</button></div>`;
  document.body.append(dialog);
  const $ = s => dialog.querySelector(s);
  $('.view-close').addEventListener('click', () => dialog.close());

  const toggles = [...SECTIONS.map(s => ({ id: s.id, label: { dyn: 'Compressore', preamp: 'Preamp' }[s.id] ?? s.label })), { id: 'pan', label: 'Pan' }];
  const toggleButtons = toggles.map(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle view-toggle';
    b.textContent = t.label;
    b.addEventListener('click', () => {
      const v = view.get();
      if (t.id === 'pan') view.set({ pan: !v.pan });
      else view.set({ sections: { [t.id]: !v.sections[t.id] } });
    });
    $('.view-toggles').append(b);
    return [t.id, b];
  });
  const channelButtons = channels.map(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle';
    b.textContent = s.label;
    mixer?.on(`${s.base}/config/name`, name => { b.textContent = name || s.label; });
    b.addEventListener('click', () => {
      const hidden = new Set(view.get().hidden);
      if (hidden.has(s.id)) hidden.delete(s.id); else hidden.add(s.id);
      view.set({ hidden: [...hidden] });
    });
    $('.view-picks').append(b);
    return [s, b];
  });
  $('.view-all').addEventListener('click', () => view.set({ hidden: [] }));
  $('.view-none').addEventListener('click', () => view.set({ hidden: channels.map(s => s.id) }));

  const segmented = (container, key, options) => options.map(([value, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => view.set({ [key]: value }));
    container.append(b);
    return [value, b];
  });
  const faderButtons = segmented($('.view-fader'), 'fader', [['normal', 'Lunghi'], ['short', 'Corti']]);
  const widthButtons = segmented($('.view-width'), 'width', [['narrow', 'Stretta'], ['normal', 'Normale'], ['wide', 'Larga']]);
  $('.view-reset').addEventListener('click', () => view.reset());

  const render = v => {
    toggleButtons.forEach(([id, b]) => b.setAttribute('aria-pressed', String(id === 'pan' ? v.pan : !!v.sections[id])));
    faderButtons.forEach(([value, b]) => b.setAttribute('aria-pressed', String(v.fader === value)));
    widthButtons.forEach(([value, b]) => b.setAttribute('aria-pressed', String(v.width === value)));
    const hidden = new Set(v.hidden);
    channelButtons.forEach(([s, b]) => {
      b.setAttribute('aria-pressed', String(!hidden.has(s.id)));
      b.hidden = !!links?.isLinked(s) && !links.isPrimary(s); // il secondo di una coppia stereo segue il primo
    });
  };
  view.onChange(render);
  render(view.get());
  return {
    open({ channels: withChannels = false } = {}) {
      $('.view-channels').hidden = !withChannels || !channels.length;
      render(view.get());
      dialog.showModal();
    },
  };
}
