// Grafici: risposta dell'EQ con RTA e nodi trascinabili, curve di gate/compressore.

import { SPEC, RATIOS, GATE_MODES, fromNorm, toNorm, paramMap } from './params.js';
import { RTA_BINS, binFreq, isCut, stripBands, stripFilters, responseDb } from './dsp.js';
import { rtaSource } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Zone dello spettro mostrate sul grafico EQ (Hz). */
export const EQ_ZONES = [[20, 60, 'Sub'], [60, 250, 'Bassi'], [250, 2000, 'Medi'], [2000, 6000, 'Presenza'], [6000, 20000, 'Aria']];
export const BAND_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#d946ef'];
const RTA_PREF = 'xair.rta';
const RTA_FLOOR = -80;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.append(el);
  return el;
}

const rtaPref = {
  get() {
    try { return localStorage.getItem(RTA_PREF) !== '0'; } catch { return true; }
  },
  set(on) {
    try { localStorage.setItem(RTA_PREF, on ? '1' : '0'); } catch { /* non disponibile */ }
  },
};

const formatFreq = f => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)}k` : `${Math.round(f)}`);

// --- grafico EQ -------------------------------------------------------------------------

/**
 * options.rta: gestore RTA (rta.js) per mostrare lo spettro dietro la curva.
 * options.feedback: monitor feedback (feedback.js) per segnare le frequenze rilevate.
 */
export function eqGraph(scope, strip, { onSelect = () => {}, rta = null, feedback = null } = {}) {
  // Su schermi stretti il grafico è meno largo in proporzione, quindi più alto e con scritte leggibili.
  const W = typeof window !== 'undefined' && window.innerWidth < 700 ? 520 : 800;
  const H = 280, PL = 36, PR = 10, PT = 10, PB = 22, RANGE = 18;
  const X = f => PL + (Math.log(f / 20) / Math.log(1000)) * (W - PL - PR);
  const freqAt = x => 20 * 1000 ** ((x - PL) / (W - PL - PR));
  const Y = db => PT + ((RANGE - db) / (2 * RANGE)) * (H - PT - PB);
  const dbAt = y => RANGE - ((y - PT) / (H - PT - PB)) * 2 * RANGE;
  const Yrta = db => PT + (clamp(db, RTA_FLOOR, 0) / RTA_FLOOR) * (H - PT - PB);

  const params = paramMap(strip);
  const base = strip.base;
  const bandAddr = (i, k) => `${base}/eq/${i + 1}/${k}`;
  const raw = address => scope.mixer.get(address);
  const val = address => scope.get(address, params.get(address));

  const wrap = document.createElement('div');
  wrap.className = 'eq-wrap';
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'eq-graph' });
  wrap.append(svg);

  const grid = svgEl('g', { class: 'grid' }, svg);
  // Zone dello spettro con un nome, per orientarsi senza conoscere le frequenze.
  EQ_ZONES.forEach(([lo, hi, name], i) => {
    if (i % 2) svgEl('rect', { x: X(lo), y: PT, width: X(hi) - X(lo), height: H - PT - PB, class: 'zone' }, grid);
    svgEl('text', { x: hi === 20000 ? X(lo) + 8 : (X(lo) + X(hi)) / 2, y: PT + 14, 'text-anchor': hi === 20000 ? 'start' : 'middle', class: 'zone-name' }, grid).textContent = name;
  });
  for (const f of W < 800 ? [100, 1000, 10000] : [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    svgEl('line', { x1: X(f), x2: X(f), y1: PT, y2: H - PB }, grid);
    svgEl('text', { x: X(f), y: H - 6, 'text-anchor': 'middle' }, grid).textContent = f >= 1000 ? `${f / 1000}k` : f;
  }
  for (const db of [-12, -6, 0, 6, 12]) {
    svgEl('line', { x1: PL, x2: W - PR, y1: Y(db), y2: Y(db), class: db === 0 ? 'zero' : '' }, grid);
    svgEl('text', { x: PL - 6, y: Y(db) + 4, 'text-anchor': 'end' }, grid).textContent = db > 0 ? `+${db}` : db;
  }
  for (const f of W < 800 ? [50, 200, 500, 2000, 5000] : []) svgEl('line', { x1: X(f), x2: X(f), y1: PT, y2: H - PB }, grid);
  const markers = svgEl('g', { class: 'fb-markers' }, svg);
  const fill = svgEl('path', { class: 'eq-fill' }, svg);
  const curve = svgEl('path', { class: 'eq-curve' }, svg);

  // Nodi: bande EQ più, per i canali, il low cut del preamp.
  const nodes = [];
  const hpAddr = strip.preamp ? `${base}/preamp/hpf` : null;
  if (hpAddr) {
    const g = svgEl('g', { class: 'eq-node hp' }, svg);
    svgEl('circle', { r: 11 }, g);
    svgEl('text', { 'text-anchor': 'middle', y: 4 }, g).textContent = 'LC';
    nodes.push({ band: 'hp', g });
  }
  for (let i = 0; i < strip.eqBands; i++) {
    const g = svgEl('g', { class: 'eq-node', style: `--c:${BAND_COLORS[i]}` }, svg);
    svgEl('circle', { r: 12 }, g);
    svgEl('text', { 'text-anchor': 'middle', y: 4 }, g).textContent = i + 1;
    nodes.push({ band: i, g });
  }

  // Etichetta con i valori della banda, visibile mentre la si regola.
  const tip = svgEl('g', { class: 'eq-tip' }, svg);
  const tipBox = svgEl('rect', { rx: 6, height: 24 }, tip);
  const tipText = svgEl('text', { y: 16 }, tip);
  let tipBand = null;
  let tipTimer = 0;
  const showTip = (band, ms = 0) => {
    tipBand = band;
    clearTimeout(tipTimer);
    if (ms) tipTimer = setTimeout(() => { tipBand = null; schedule(); }, ms);
    schedule();
  };

  let selected = 0;
  const select = band => {
    selected = band;
    nodes.forEach(n => n.g.classList.toggle('selected', n.band === band));
  };

  let frame = 0;
  const render = () => {
    frame = 0;
    const { eqOn, hpOn, hpf, bands } = stripBands(strip, raw);
    const filters = stripFilters(strip, raw);
    let d = '';
    for (let k = 0; k <= 240; k++) {
      const f = 20 * 1000 ** (k / 240);
      d += `${k ? 'L' : 'M'}${X(f).toFixed(1)} ${Y(clamp(responseDb(filters, f), -RANGE - 2, RANGE + 2)).toFixed(1)}`;
    }
    curve.setAttribute('d', d);
    fill.setAttribute('d', `${d}L${X(20000)} ${Y(0)}L${X(20)} ${Y(0)}Z`);
    svg.classList.toggle('off', !eqOn);
    tip.classList.toggle('visible', tipBand !== null);
    if (tipBand !== null) {
      const isHp = tipBand === 'hp';
      const b = isHp ? null : bands[tipBand];
      const typeName = isHp ? '' : params.get(bandAddr(tipBand, 'type')).options[val(bandAddr(tipBand, 'type'))];
      tipText.textContent = isHp
        ? `Low cut · ${formatFreq(hpf)} Hz`
        : [`${formatFreq(b.f)} Hz`, isCut(typeName) ? null : `${b.g > 0.05 ? '+' : ''}${b.g.toFixed(1)} dB`, `Q ${b.q.toFixed(1)}`].filter(Boolean).join(' · ');
      const w = tipText.getComputedTextLength?.() || tipText.textContent.length * 7;
      const x = clamp((isHp ? X(hpf) : X(b.f)) - w / 2 - 8, PL, W - PR - w - 16);
      const yNode = isHp ? H - PB - 14 : Y(b.g);
      const y = yNode > PT + 50 ? yNode - 44 : yNode + 20;
      tip.setAttribute('transform', `translate(${x} ${y})`);
      tipBox.setAttribute('width', w + 16);
      tipText.setAttribute('x', 8);
    }
    for (const n of nodes) {
      if (n.band === 'hp') {
        // in basso, sotto la curva, per non coprire la banda 1
        n.g.setAttribute('transform', `translate(${X(hpf)} ${H - PB - 14})`);
        n.g.classList.toggle('inactive', !hpOn);
      } else {
        const b = bands[n.band];
        n.g.setAttribute('transform', `translate(${X(b.f)} ${Y(b.g)})`);
      }
    }
  };
  const schedule = () => { frame ||= requestAnimationFrame(render); };
  for (const address of params.keys()) if (address.includes('/eq/') || address.includes('/preamp/hp')) scope.on(address, schedule);
  render();

  // --- RTA --------------------------------------------------------------------------
  // Disegnato su canvas sotto la curva. Il mixer invia ~10 spettri al secondo: tra uno e l'altro
  // l'animazione si avvicina dolcemente al nuovo valore, così la lettura resta fluida.
  const canvas = rta ? document.createElement('canvas') : null;
  let ctx = null;
  try { ctx = canvas?.getContext('2d') ?? null; } catch { /* canvas non disponibile: niente RTA */ }
  if (rta && ctx) {
    canvas.className = 'rta-canvas';
    wrap.prepend(canvas);
    const target = new Float32Array(RTA_BINS).fill(RTA_FLOOR);
    const shown = new Float32Array(RTA_BINS).fill(RTA_FLOOR);
    const peak = new Float32Array(RTA_BINS).fill(RTA_FLOOR);
    const xs = Array.from({ length: RTA_BINS }, (_, i) => X(binFreq(i)));
    let release = null;
    let running = false;
    let lastData = 0;

    const onSpectrum = spectrum => {
      lastData = performance.now();
      for (let i = 0; i < RTA_BINS; i++) {
        // smussamento leggero tra bande vicine
        const l = spectrum[Math.max(0, i - 1)], c = spectrum[i], r = spectrum[Math.min(RTA_BINS - 1, i + 1)];
        target[i] = Math.max(RTA_FLOOR, 0.25 * l + 0.5 * c + 0.25 * r);
      }
    };

    const resize = () => {
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * scale);
      canvas.height = Math.round(canvas.clientHeight * scale);
    };

    const draw = () => {
      if (!running) return;
      requestAnimationFrame(draw);
      if (!canvas.width) resize();
      // senza dati da più di 1 s (es. sorgente in pausa) lo spettro scende piano
      const stale = performance.now() - lastData > 1000;
      let moving = false;
      for (let i = 0; i < RTA_BINS; i++) {
        const goal = stale ? RTA_FLOOR : target[i];
        const step = (goal - shown[i]) * (goal > shown[i] ? 0.45 : 0.18);
        if (Math.abs(step) > 0.05) moving = true;
        shown[i] += step;
        peak[i] = shown[i] > peak[i] ? shown[i] : peak[i] - 0.15;
      }
      if (!moving && stale) return;
      const sx = canvas.width / W, sy = canvas.height / H;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.moveTo(xs[0] * sx, Yrta(RTA_FLOOR) * sy);
      for (let i = 0; i < RTA_BINS; i++) ctx.lineTo(xs[i] * sx, Yrta(shown[i]) * sy);
      ctx.lineTo(xs[RTA_BINS - 1] * sx, Yrta(RTA_FLOOR) * sy);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, PT * sy, 0, (H - PB) * sy);
      // colori dal tema (variabili CSS --rta-canvas-*), con i valori del tema scuro come riserva
      const css = window.getComputedStyle(canvas);
      const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      gradient.addColorStop(0, color('--rta-canvas-top', 'rgba(56, 189, 248, 0.30)'));
      gradient.addColorStop(1, color('--rta-canvas-bottom', 'rgba(56, 189, 248, 0.04)'));
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < RTA_BINS; i++) ctx[i ? 'lineTo' : 'moveTo'](xs[i] * sx, Yrta(peak[i]) * sy);
      ctx.strokeStyle = color('--rta-canvas-peak', 'rgba(125, 211, 252, 0.45)');
      ctx.lineWidth = Math.max(1, sx);
      ctx.stroke();
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rta-btn';
    btn.textContent = 'RTA';
    const setOn = on => {
      btn.setAttribute('aria-pressed', String(on));
      release?.();
      release = null;
      target.fill(RTA_FLOOR);
      shown.fill(RTA_FLOOR);
      peak.fill(RTA_FLOOR);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      running = on;
      if (on) {
        release = rta.request(rtaSource(strip), onSpectrum, () => 3, { focus: true });
        requestAnimationFrame(draw);
      }
    };
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      rtaPref.set(on);
      setOn(on);
    });
    setOn(rtaPref.get());
    scope.add(() => {
      running = false;
      release?.();
      observer?.disconnect();
    });
    wrap.append(btn);
  }

  // --- frequenze di feedback rilevate -------------------------------------------------------
  if (feedback) {
    const drawMarkers = () => {
      markers.innerHTML = '';
      for (const a of feedback.alertsFor(strip.id)) {
        const x = X(a.freq);
        svgEl('line', { x1: x, x2: x, y1: PT, y2: H - PB }, markers);
        svgEl('text', { x: x + 4, y: PT + 12 }, markers).textContent = `FB ${formatFreq(a.freq)}`;
      }
    };
    drawMarkers();
    scope.add(feedback.onChange(drawMarkers));
  }

  // --- trascinamento dei nodi: orizzontale = frequenza, verticale = guadagno, rotella = Q ----------
  const toSvg = e => {
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const setReal = (address, x) => {
    const spec = params.get(address);
    scope.set(address, spec, clamp(toNorm(spec, x), 0, 1));
  };
  let dragging = null;
  // Due dita sul grafico: allargarle rende la banda selezionata più larga (Q più basso).
  const pointers = new Map();
  let pinch = null;
  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; };
  svg.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, toSvg(e));
    if (pointers.size === 2 && typeof selected === 'number') {
      dragging = null;
      pinch = { d0: spread(), q0: fromNorm(SPEC.eqQ, val(bandAddr(selected, 'q'))) };
      showTip(selected);
    }
  }, true);
  const choose = band => {
    select(band);
    onSelect(band);
  };
  nodes.forEach(n => {
    n.g.addEventListener('pointerdown', e => {
      e.stopPropagation();
      svg.setPointerCapture(e.pointerId);
      if (pointers.size > 1) return;
      dragging = n.band;
      if (n.band !== 'hp') choose(n.band);
      showTip(n.band);
    });
    n.g.addEventListener('dblclick', () => {
      if (n.band === 'hp') return scope.set(`${base}/preamp/hpon`, SPEC.hpon, val(`${base}/preamp/hpon`) ? 0 : 1);
      setReal(bandAddr(n.band, 'g'), 0);
    });
  });
  // Tocco su un punto vuoto: seleziona la banda più vicina in frequenza.
  svg.addEventListener('pointerdown', e => {
    if (pointers.size > 1) return;
    const f = freqAt(toSvg(e)[0]);
    const { bands } = stripBands(strip, raw);
    const near = bands.reduce((best, b, i) => (Math.abs(Math.log(b.f / f)) < Math.abs(Math.log(bands[best].f / f)) ? i : best), 0);
    choose(near);
    showTip(near, 1500);
  });
  svg.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, toSvg(e));
    if (pinch && pointers.size === 2) {
      const q = clamp(pinch.q0 * (pinch.d0 / spread()), 0.3, 10);
      scope.set(bandAddr(selected, 'q'), SPEC.eqQ, clamp(toNorm(SPEC.eqQ, q), 0, 1));
      return;
    }
    if (dragging === null) return;
    const [x, y] = toSvg(e);
    const f = freqAt(x);
    if (dragging === 'hp') return setReal(hpAddr, clamp(f, 20, 400));
    setReal(bandAddr(dragging, 'f'), clamp(f, 20, 20000));
    const type = params.get(bandAddr(dragging, 'type')).options[val(bandAddr(dragging, 'type'))];
    if (!isCut(type)) setReal(bandAddr(dragging, 'g'), clamp(dbAt(y), -15, 15));
  });
  const stop = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (dragging !== null || !pointers.size) showTip(tipBand, 1200);
    dragging = null;
  };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const address = bandAddr(selected, 'q');
    scope.set(address, SPEC.eqQ, clamp(val(address) + Math.sign(e.deltaY) * 0.02, 0, 1));
    showTip(selected, 1200);
  }, { passive: false });
  scope.add(() => clearTimeout(tipTimer));

  select(0);
  return { el: wrap, select };
}

// --- curve gate / compressore --------------------------------------------------------------

export function dynGraph(scope, strip, kind) {
  const S = 200;
  const lo = kind === 'gate' ? -80 : -60;
  const P = db => ((clamp(db, lo, 0) - lo) / -lo) * S;
  const base = `${strip.base}/${kind}`;
  const spec = SPEC[kind];
  const get = k => scope.get(`${base}/${k}`, spec[k]);
  const real = k => fromNorm(spec[k], get(k));

  const transfer = kind === 'gate'
    ? input => {
      const thr = real('thr'), range = real('range'), mode = GATE_MODES[get('mode')];
      if (mode === 'DUCK') return input > thr ? input - range : input;
      if (input >= thr) return input;
      if (mode === 'GATE') return input - range;
      const ratio = Number(mode.slice(3));
      return Math.max(thr + (input - thr) * ratio, input - range);
    }
    : input => {
      const thr = real('thr'), ratio = Number(RATIOS[get('ratio')]), knee = real('knee') * 5;
      const over = input - thr;
      let out;
      if (get('mode') === 1) out = input < thr ? thr + over * ratio : input; // espansore
      else if (2 * over < -knee) out = input;
      else if (knee > 0 && 2 * Math.abs(over) <= knee) out = input + ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
      else out = thr + over / ratio;
      return out + real('mgain');
    };

  const svg = svgEl('svg', { viewBox: `-24 -6 ${S + 30} ${S + 26}`, class: 'dyn-graph' });
  const grid = svgEl('g', { class: 'grid' }, svg);
  for (let db = lo; db <= 0; db += kind === 'gate' ? 20 : 10) {
    svgEl('line', { x1: P(db), x2: P(db), y1: 0, y2: S }, grid);
    svgEl('line', { x1: 0, x2: S, y1: S - P(db), y2: S - P(db) }, grid);
    svgEl('text', { x: -4, y: S - P(db) + 3, 'text-anchor': 'end' }, grid).textContent = db;
    svgEl('text', { x: P(db), y: S + 14, 'text-anchor': 'middle' }, grid).textContent = db;
  }
  svgEl('line', { x1: 0, y1: S, x2: S, y2: 0, class: 'unity' }, svg);
  const thrLine = svgEl('line', { class: 'thr', y1: 0, y2: S }, svg);
  const curve = svgEl('path', { class: 'dyn-curve' }, svg);
  const dot = svgEl('circle', { class: 'dyn-dot', r: 5 }, svg);

  const render = () => {
    let d = '';
    for (let k = 0; k <= 120; k++) {
      const input = lo + (-lo * k) / 120;
      d += `${k ? 'L' : 'M'}${P(input).toFixed(1)} ${(S - P(transfer(input))).toFixed(1)}`;
    }
    curve.setAttribute('d', d);
    const t = P(real('thr'));
    thrLine.setAttribute('x1', t);
    thrLine.setAttribute('x2', t);
    svg.classList.toggle('off', !get('on'));
  };
  for (const k of Object.keys(spec)) scope.on(`${base}/${k}`, render);
  render();

  // Punto che segue il livello d'ingresso in tempo reale.
  const meterIndex = strip.meters[0];
  let running = true;
  scope.add(() => { running = false; });
  const loop = () => {
    if (!running) return;
    const level = scope.mixer.meters[meterIndex];
    const visible = level > lo;
    dot.style.display = visible ? '' : 'none';
    if (visible) {
      dot.setAttribute('cx', P(level));
      dot.setAttribute('cy', S - P(transfer(level)));
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return svg;
}
