// Pagina Meter (come in X-AIR-Edit): tutti i livelli del mixer in un colpo d'occhio
// (ingressi, ritorni effetti, bus, mandate, main) e un RTA grande con la sorgente a scelta.
// L'RTA viene chiesto al mixer solo mentre la pagina è aperta.

import { createMeter, applyColor } from './ui.js';
import { rtaSource } from './model.js';
import { RTA_BINS, binFreq } from './dsp.js';

const METER_FLOOR = -60; // come le strip
const RTA_FLOOR = -80;
const SCALE = [0, -6, -12, -18, -24, -36, -48, -60];

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

export function createMeterPage({ mixer, strips, rta, container }) {
  const root = h('div', 'meter-page');
  const byId = id => strips.find(s => s.id === id);

  // --- ponti di meter ----------------------------------------------------------------------
  const items = [];
  const scale = () => {
    const s = h('div', 'mb-scale');
    for (const db of SCALE) {
      const m = h('span', null, db === 0 ? '0' : String(db));
      m.style.setProperty('--p', String((db - METER_FLOOR) / -METER_FLOOR));
      s.append(m);
    }
    return s;
  };
  const bridge = (title, entries) => {
    const sec = h('section', 'mb-block');
    sec.append(h('h2', null, title));
    const row = h('div', 'mb-row');
    row.append(scale());
    for (const e of entries) {
      const col = h('div', 'mb-item');
      const peak = h('span', 'mb-peak', '-∞');
      const bars = h('div', 'mb-bars');
      e.meters.forEach(i => bars.append(createMeter(i)));
      const name = h('span', 'mb-name', e.label);
      col.append(peak, bars, name);
      if (e.strip) {
        mixer.on(`${e.strip.base}/config/name`, n => { name.textContent = n || e.label; });
        mixer.on(`${e.strip.base}/config/color`, c => applyColor(col, c));
        applyColor(col, mixer.get(`${e.strip.base}/config/color`, 0));
        name.textContent = mixer.get(`${e.strip.base}/config/name`) || e.label;
      } else {
        applyColor(col, 0);
      }
      row.append(col);
      items.push({ meters: e.meters, peak, max: -Infinity, at: 0 });
    }
    sec.append(row);
    return sec;
  };
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
  const inputs = [
    ...range(16, i => ({ label: `Ch ${i}`, strip: byId(`ch${i}`), meters: [i - 1] })),
    { label: 'Aux', strip: byId('aux'), meters: [16, 17] },
    ...range(4, i => ({ label: `FX ${i}`, strip: byId(`rtn${i}`), meters: [16 + i * 2, 17 + i * 2] })),
  ];
  const outputs = [
    ...range(6, i => ({ label: `Bus ${i}`, strip: byId(`bus${i}`), meters: [25 + i] })),
    ...range(4, i => ({ label: `Send ${i}`, strip: byId(`fxsend${i}`), meters: [31 + i] })),
    { label: 'Main', strip: byId('lr'), meters: [36, 37] },
    { label: 'Cuffie', meters: [38, 39] },
  ];
  const bridges = h('div', 'mb-bridges');
  bridges.append(bridge('Ingressi', inputs), bridge('Uscite', outputs));

  // --- RTA grande -------------------------------------------------------------------------------
  const rtaBox = h('section', 'mb-block mb-rta');
  const head = h('header', 'mb-rta-head');
  head.append(h('h2', null, 'Analizzatore (RTA)'));
  const select = h('select', 'preset-select mb-rta-source');
  const sources = strips.filter(s => rtaSource(s) !== null);
  for (const s of sources) {
    const o = new Option(s.label, s.id);
    if (rtaSource(s) > 16) o.text += ' (?)'; // numerazione da confermare per ritorni, bus e main
    select.add(o);
    mixer.on(`${s.base}/config/name`, n => { o.text = (n || s.label) + (rtaSource(s) > 16 ? ' (?)' : ''); });
  }
  select.value = 'lr';
  head.append(select);
  const canvas = h('canvas', 'mb-rta-canvas');
  rtaBox.append(head, canvas);

  root.append(bridges, rtaBox);
  container.append(root);

  // --- animazione e RTA solo con la pagina visibile ---------------------------------------------
  const shown = new Float32Array(RTA_BINS).fill(RTA_FLOOR);
  const peaks = new Float32Array(RTA_BINS).fill(RTA_FLOOR);
  let target = new Float32Array(RTA_BINS).fill(RTA_FLOOR);
  let release = null;
  let visible = false;
  let raf = 0;
  let timer = 0;
  const xs = Array.from({ length: RTA_BINS }, (_, i) => Math.log(binFreq(i) / 20) / Math.log(1000));

  const listen = () => {
    release?.();
    target.fill(RTA_FLOOR);
    const s = byId(select.value);
    release = s ? rta.request(rtaSource(s), spectrum => { target = Float32Array.from(spectrum); }, () => 3, { focus: true }) : null;
  };
  select.addEventListener('change', () => { if (visible) listen(); });

  const draw = () => {
    raf = 0;
    if (!visible) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const css = window.getComputedStyle(canvas);
    const color = (n, f) => css.getPropertyValue(n).trim() || f;
    const PL = 34 * dpr, PB = 18 * dpr, W = canvas.width - PL - 6 * dpr, H = canvas.height - PB - 6 * dpr;
    const X = x => PL + x * W;
    const Y = db => 6 * dpr + (Math.min(0, Math.max(RTA_FLOOR, db)) / RTA_FLOOR) * H;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // griglia
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = color('--muted', '#888');
    ctx.strokeStyle = color('--grid', '#eee');
    ctx.lineWidth = dpr;
    for (let db = 0; db >= RTA_FLOOR; db -= 12) {
      ctx.beginPath(); ctx.moveTo(PL, Y(db)); ctx.lineTo(PL + W, Y(db)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(String(db), PL - 6 * dpr, Y(db) + 3 * dpr);
    }
    for (const f of [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
      const x = X(Math.log(f / 20) / Math.log(1000));
      ctx.beginPath(); ctx.moveTo(x, 6 * dpr); ctx.lineTo(x, 6 * dpr + H); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, canvas.height - 4 * dpr);
    }
    // spettro: barre con picco che scende piano
    const bw = Math.max(1, (W / RTA_BINS) * 0.78);
    ctx.fillStyle = color('--accent', '#3e6ae1');
    for (let i = 0; i < RTA_BINS; i++) {
      shown[i] += (target[i] - shown[i]) * (target[i] > shown[i] ? 0.5 : 0.2);
      peaks[i] = shown[i] > peaks[i] ? shown[i] : peaks[i] - 0.25;
      const x = X(xs[i]) - bw / 2;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, Y(shown[i]), bw, Y(RTA_FLOOR) - Y(shown[i]));
      ctx.globalAlpha = 1;
      ctx.fillRect(x, Y(peaks[i]) - dpr, bw, 1.5 * dpr);
    }
    raf = requestAnimationFrame(draw);
  };

  // valore di picco numerico di ogni meter, aggiornato 5 volte al secondo
  const updatePeaks = () => {
    const now = performance.now();
    for (const it of items) {
      const db = Math.max(...it.meters.map(i => mixer.meters[i] ?? -128));
      if (db >= it.max || now - it.at > 2000) { it.max = db; it.at = now; }
      it.peak.textContent = it.max <= -90 ? '-∞' : it.max.toFixed(it.max > -10 ? 1 : 0);
      it.peak.classList.toggle('clip', it.max >= -0.5);
    }
  };

  return {
    setVisible(v) {
      if (v === visible) return;
      visible = v;
      if (v) {
        listen();
        raf ||= requestAnimationFrame(draw);
        timer = setInterval(updatePeaks, 200);
      } else {
        release?.();
        release = null;
        clearInterval(timer);
      }
    },
  };
}
