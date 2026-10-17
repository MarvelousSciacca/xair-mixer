// Controlli collegati ai parametri del mixer: manopola, interruttore, selettore.

import { defaultValue, formatValue, oscType } from './params.js';

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Raccoglie le iscrizioni ai parametri di un pannello, per rimuoverle tutte alla chiusura. */
export class Scope {
  constructor(mixer) {
    this.mixer = mixer;
    this.offs = [];
  }
  on(address, cb) {
    this.offs.push(this.mixer.on(address, cb));
  }
  /** Registra una funzione di pulizia qualsiasi. */
  add(off) {
    this.offs.push(off);
  }
  get(address, spec) {
    return this.mixer.get(address, defaultValue(spec));
  }
  set(address, spec, value) {
    this.mixer.set(address, value, oscType(spec));
  }
  dispose() {
    this.offs.forEach(off => off());
    this.offs = [];
  }
}

const polar = a => {
  const r = (a * Math.PI) / 180;
  return `${(50 + 38 * Math.sin(r)).toFixed(2)} ${(50 - 38 * Math.cos(r)).toFixed(2)}`;
};
const arcPath = (a0, a1) => (a1 - a0 < 0.5 ? '' : `M ${polar(a0)} A 38 38 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${polar(a1)}`);

/** Gestisce trascinamento verticale, rotella, tastiera e doppio clic su un elemento. */
export function dragValue(el, { get, set, reset, step = 0.01, pixels = 200 }) {
  let start = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    start = { y: e.clientY, v: get() };
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', e => {
    if (start) set(clamp(start.v + (start.y - e.clientY) / (pixels * (e.shiftKey ? 5 : 1))));
  });
  const end = () => {
    start = null;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', reset);
  el.addEventListener('wheel', e => {
    e.preventDefault();
    set(clamp(get() - Math.sign(e.deltaY) * step * (e.shiftKey ? 0.2 : 1)));
  }, { passive: false });
  el.addEventListener('keydown', e => {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (dir) set(clamp(get() + dir * step));
    else if (e.key === 'Home') reset();
    else return;
    e.preventDefault();
  });
}

export function knob(scope, address, spec, { label = spec.label, big = false, reset = defaultValue(spec) } = {}) {
  const el = document.createElement('div');
  el.className = `knob${big ? ' big' : ''}`;
  el.innerHTML = `
    <div class="knob-label"></div>
    <div class="knob-dial" tabindex="0" role="slider">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path class="knob-track" d="${arcPath(-135, 135)}"/>
        <path class="knob-arc"/>
        <circle class="knob-body" cx="50" cy="50" r="28"/>
        <line class="knob-pointer" x1="50" y1="40" x2="50" y2="25"/>
      </svg>
    </div>
    <div class="knob-value"></div>`;
  el.querySelector('.knob-label').textContent = label;
  const dial = el.querySelector('.knob-dial');
  dial.setAttribute('aria-label', label);
  const arc = el.querySelector('.knob-arc');
  const pointer = el.querySelector('.knob-pointer');
  const valueEl = el.querySelector('.knob-value');

  const isEnum = spec.kind === 'enum';
  const count = isEnum ? spec.options.length : 0;
  const toPos = v => (isEnum ? v / (count - 1) : v);

  const render = v => {
    const angle = -135 + 270 * toPos(v);
    const from = spec.bipolar ? 0 : -135;
    arc.setAttribute('d', arcPath(Math.min(from, angle), Math.max(from, angle)));
    pointer.setAttribute('transform', `rotate(${angle} 50 50)`);
    const text = formatValue(spec, v);
    valueEl.textContent = text;
    dial.setAttribute('aria-valuetext', text);
  };
  render(scope.get(address, spec));
  scope.on(address, render);

  dragValue(dial, {
    step: isEnum ? 1 / (count - 1) : 0.01,
    get: () => toPos(scope.get(address, spec)),
    set: p => {
      const v = isEnum ? Math.round(p * (count - 1)) : p;
      if (v !== scope.get(address, spec)) scope.set(address, spec, v);
    },
    reset: () => scope.set(address, spec, reset),
  });
  return el;
}

export function toggle(scope, address, spec, { label = spec.label, className = '' } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `toggle ${className}`;
  btn.textContent = label;
  const render = v => btn.setAttribute('aria-pressed', String(!!v));
  render(scope.get(address, spec));
  scope.on(address, render);
  btn.addEventListener('click', () => scope.set(address, spec, scope.get(address, spec) ? 0 : 1));
  return btn;
}

/**
 * Interruttore di un singolo bit di una maschera (es. appartenenza a DCA o mute group).
 * labelAddress: parametro col nome da mostrare (es. nome del DCA), con fallback.
 */
export function bitToggle(scope, address, spec, bit, { label, labelAddress } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toggle';
  btn.textContent = label;
  if (labelAddress) scope.on(labelAddress, name => { btn.textContent = name || label; });
  const render = v => btn.setAttribute('aria-pressed', String(!!(v & (1 << bit))));
  render(scope.get(address, spec));
  scope.on(address, render);
  btn.addEventListener('click', () => scope.set(address, spec, scope.get(address, spec) ^ (1 << bit)));
  return btn;
}

/** Valore intero con pulsanti − e + (parametri interi di cui non si conosce il significato). */
export function stepper(scope, address, { label, max = 99 } = {}) {
  const spec = { kind: 'int', def: 0 };
  const wrap = document.createElement('div');
  wrap.className = 'stepper';
  wrap.innerHTML = '<div class="knob-label"></div><div class="stepper-row"><button type="button">−</button><span></span><button type="button">+</button></div>';
  wrap.querySelector('.knob-label').textContent = label;
  const out = wrap.querySelector('span');
  const render = v => { out.textContent = String(Math.round(v)); };
  render(scope.get(address, spec));
  scope.on(address, render);
  const [minus, plus] = wrap.querySelectorAll('button');
  const step = d => scope.set(address, spec, Math.min(max, Math.max(0, Math.round(scope.get(address, spec)) + d)));
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  return wrap;
}

/** Pulsanti affiancati per enum con poche opzioni, menu a tendina per le altre. */
export function choice(scope, address, spec, { label = spec.label } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'choice';
  const title = document.createElement('div');
  title.className = 'choice-label';
  title.textContent = label;
  wrap.append(title);

  if (spec.options.length <= 5) {
    const group = document.createElement('div');
    group.className = 'segmented';
    const buttons = spec.options.map((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', () => scope.set(address, spec, i));
      group.append(b);
      return b;
    });
    const render = v => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === v)));
    render(scope.get(address, spec));
    scope.on(address, render);
    wrap.append(group);
  } else {
    const select = document.createElement('select');
    spec.options.forEach((text, i) => select.add(new Option(text, i)));
    const render = v => { select.value = String(v); };
    render(scope.get(address, spec));
    scope.on(address, render);
    select.addEventListener('change', () => scope.set(address, spec, Number(select.value)));
    wrap.append(select);
  }
  return wrap;
}
