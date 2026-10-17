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
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(view)); } catch { /* non disponibile */ }
  };

  /** Densità più ricca che lascia al fader almeno l'altezza minima. */
  const density = () => {
    const h = stripsEl.clientHeight || window.innerHeight;
    const shown = SECTIONS.filter(s => view.sections[s.id]).map(s => s.id);
    const need = d => shown.reduce((sum, id) => sum + SECTION_HEIGHT[d][id] + 4, 0)
      + (d === 'mini' && shown.some(id => ['gate', 'dyn', 'eq'].includes(id)) ? MINI_ROW : 0);
    return ['full', 'compact', 'mini'].find(d => FIXED + need(d) + FADER_MIN[view.fader] <= h) ?? 'mini';
  };

  const apply = () => {
    const shown = Object.entries(view.sections).filter(([, on]) => on).map(([id]) => id);
    if (view.pan) shown.push('pan');
    for (const target of [mixerEl, document.body]) target.dataset.show = shown.join(' ');
    mixerEl.dataset.fader = view.fader;
    mixerEl.dataset.density = density();
    document.documentElement.style.setProperty('--strip-scale', String(WIDTHS[view.width]));
    // la riga G/C/EQ sparisce se tutte le sue sezioni sono già visibili come miniature
    for (const proc of document.querySelectorAll('.mixer .proc')) {
      const tabs = [...proc.querySelectorAll('.proc-btn')].map(b => b.dataset.tab);
      proc.classList.toggle('all-hidden', tabs.every(t => view.sections[t]));
    }
    listeners.forEach(cb => cb(view));
  };

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const d = density();
    if (mixerEl.dataset.density !== d) mixerEl.dataset.density = d;
  }) : null;
  observer?.observe(stripsEl);
  window.addEventListener('resize', () => { mixerEl.dataset.density = density(); });
  apply();

  return {
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

/** Pannello "Vista": interruttori per sezioni e pan, scelta di fader e larghezza. */
export function createViewPanel(view) {
  const dialog = document.createElement('dialog');
  dialog.className = 'view-dialog';
  dialog.innerHTML = `
    <div class="dialog-head"><h2>Vista</h2><button class="icon-btn view-close" type="button" aria-label="Chiudi">✕</button></div>
    <p class="view-help">Scegli cosa mostrare su ogni canale. Se lo spazio non basta, le sezioni si compattano da sole.</p>
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
  };
  view.onChange(render);
  render(view.get());
  return { open: () => dialog.showModal() };
}
