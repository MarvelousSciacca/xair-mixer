// Componenti dell'interfaccia: channel strip, fader, pan e meter.

import { ZERO_DB, faderToDb, dbToFader, formatDb } from './mixer.js';
import { COLORS, soloAddress } from './model.js';
import { sendAddress } from './params.js';
import { createStripSections } from './strip-sections.js';
import { fineFactor, doubleTap, TAP_SLOP_PX } from './controls.js';

const FADER_MARKS = [10, 5, 0, -5, -10, -20, -30, -50, -Infinity];
const METER_FLOOR = -60;
const PEAK_HOLD_MS = 1200;
const METER_HTML = '<div class="meter"><div class="meter-cover"></div><div class="meter-peak"></div></div>';
const PROC = [
  { key: 'gate', tab: 'gate', addr: 'gate/on', text: 'G' },
  { key: 'dyn', tab: 'dyn', addr: 'dyn/on', text: 'C' },
  { key: 'eqBands', tab: 'eq', addr: 'eq/on', text: 'EQ' },
];

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

// --- meter -------------------------------------------------------------------

const meterRegistry = new Set();

export function startMeterLoop(mixer) {
  // Il mixer manda i meter ~20 volte al secondo: si scrive nel DOM solo ciò che è cambiato davvero
  // (posizioni arrotondate a 1/200), così i fotogrammi restano liberi per i fader.
  const frame = () => {
    const now = performance.now();
    for (const m of meterRegistry) {
      if (!m.el.isConnected) continue;
      const db = mixer.meters[m.index];
      const pos = Math.round(clamp((db - METER_FLOOR) / -METER_FLOOR) * 200) / 200;
      if (pos !== m.pos) {
        m.pos = pos;
        m.cover.style.transform = `scaleY(${1 - pos})`;
      }
      if (pos >= m.peak || now - m.peakTime > PEAK_HOLD_MS) {
        m.peakTime = now;
        if (pos !== m.peak) {
          m.peak = pos;
          m.peakEl.style.transform = `translateY(${(1 - pos) * 100}%)`;
        }
        const clip = db >= -0.5;
        if (clip !== m.clip) {
          m.clip = clip;
          m.peakEl.classList.toggle('clip', clip);
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function registerMeter(el, index) {
  meterRegistry.add({
    el,
    index,
    cover: el.querySelector('.meter-cover'),
    peakEl: el.querySelector('.meter-peak'),
    pos: -1,
    peak: -1,
    peakTime: 0,
    clip: false,
  });
}

/** Meter singolo (indice in /meters/1) aggiornato dal ciclo comune: usato dalla pagina Meter. */
export function createMeter(index) {
  const holder = document.createElement('div');
  holder.innerHTML = METER_HTML;
  const el = holder.firstChild;
  registerMeter(el, index);
  return el;
}

// --- trascinamento generico (fader e pan) --------------------------------------

function draggable(el, { getValue, setValue, axis, length, reset, onGrab = () => {}, onRelease = () => {} }) {
  let start = null;
  // i movimenti arrivano anche a 120-240 al secondo: si applica solo l'ultimo di ogni fotogramma
  let next = null;
  let raf = 0;
  const tap = doubleTap();
  const apply = () => {
    raf = 0;
    if (next !== null) setValue(next);
    next = null;
  };
  const along = e => (axis === 'y' ? -e.clientY : e.clientX);
  const across = e => (axis === 'y' ? e.clientX : e.clientY);
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (tap.down(e)) return setValue(reset);
    el.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, at: along(e), side: across(e), v: getValue(), len: length(), slop: e.pointerType === 'mouse' ? 0 : TAP_SLOP_PX, moved: false };
    el.classList.add('dragging');
    onGrab();
  });
  el.addEventListener('pointermove', e => {
    if (!start) return;
    const pos = along(e);
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < start.slop) return;
    start.moved = true;
    const fine = e.shiftKey ? 0.2 : fineFactor(Math.abs(across(e) - start.side));
    // movimento relativo: cambiando la finezza a metà corsa il valore non salta
    start.v = clamp(start.v + ((pos - start.at) / start.len) * fine);
    start.at = pos;
    el.classList.toggle('fine', fine < 1);
    next = start.v;
    raf ||= requestAnimationFrame(apply);
  });
  const end = e => {
    if (!start) return;
    if (raf) {
      cancelAnimationFrame(raf);
      apply();
    }
    tap.up(e, start.moved);
    start = null;
    el.classList.remove('dragging', 'fine');
    onRelease();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => setValue(reset));
  el.addEventListener('wheel', e => {
    e.preventDefault();
    setValue(clamp(getValue() - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.01)));
  }, { passive: false });
  el.addEventListener('keydown', e => {
    const steps = { ArrowUp: 0.01, ArrowRight: 0.01, ArrowDown: -0.01, ArrowLeft: -0.01, PageUp: 0.1, PageDown: -0.1 };
    if (e.key in steps) setValue(clamp(getValue() + steps[e.key]));
    else if (e.key === 'Home') setValue(reset);
    else return;
    e.preventDefault();
  });
}

// --- channel strip -----------------------------------------------------------

function panLabel(v) {
  const p = Math.round((v - 0.5) * 200);
  return p === 0 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.abs(p)}`;
}

export function applyColor(el, index) {
  const c = COLORS[index] ?? COLORS[0];
  el.style.setProperty('--strip-color', c.hex);
  el.classList.toggle('inverted', c.inverted);
}

/**
 * Crea una channel strip. Se la strip ha mandate, el.setSend(n) collega il fader alla mandata n
 * ("sends on fader"); el.setSend(null) lo riporta al fader principale.
 */
export function createStrip(mixer, strip, { onEdit, onProcess, editable, links = null }) {
  const el = document.createElement('div');
  el.className = `strip strip-${strip.group}`;
  el.dataset.id = strip.id;

  const marks = FADER_MARKS.map(db => {
    const pos = dbToFader(db);
    const text = Number.isFinite(db) ? (db > 0 ? `+${db}` : `${db}`) : '-∞';
    return `<span class="mark${db === 0 ? ' zero' : ''}${[10, 0, -10, -30, -Infinity].includes(db) ? ' major' : ''}" style="--p:${pos}">${text}</span>`;
  }).join('');

  el.innerHTML = `
    <button class="scribble" type="button" title="Modifica nome e colore"></button>
    <div class="proc">${PROC.filter(p => strip[p.key]).map(p =>
      `<button class="proc-btn" type="button" data-tab="${p.tab}" data-addr="${p.addr}">${p.text}</button>`).join('')}</div>
    ${strip.pan
      ? `<div class="pan" tabindex="0" role="slider" aria-label="Pan ${strip.label}">
           <div class="pan-track"><div class="pan-fill"></div></div><span class="pan-val">C</span>
         </div>`
      : '<div class="pan pan-none"></div>'}
    <div class="fader-area">
      <div class="meters">${strip.meters.map(() => METER_HTML).join('')}${strip.linkMeter !== undefined ? METER_HTML.replace('"meter"', '"meter link-only"') : ''}</div>
      <div class="fader" tabindex="0" role="slider" aria-label="Fader ${strip.label}">
        <div class="fader-scale">${marks}</div>
        <div class="fader-slot"></div>
        <div class="fader-cap"></div>
      </div>
    </div>
    <div class="db"><span class="db-val">-∞</span></div>
    <div class="buttons">
      ${strip.solo ? '<button class="solo" type="button" aria-label="Solo" title="Solo">S</button>' : ''}
      <button class="mute" type="button" aria-label="Mute" title="Mute">M</button>
    </div>
    <button class="label" type="button" title="Elaborazione del canale">${strip.label}</button>`;

  const $ = sel => el.querySelector(sel);
  const base = strip.base;
  // sezioni in miniatura (preamp, gate, compressore, EQ, mandate): visibili secondo la "Vista"
  $('.proc').after(createStripSections(mixer, strip, { onProcess }));

  // Nome e colore
  const scribble = $('.scribble');
  mixer.on(`${base}/config/name`, name => {
    scribble.textContent = name || strip.label;
  });
  scribble.textContent = strip.label;
  mixer.on(`${base}/config/color`, c => applyColor(el, c));
  applyColor(el, 0);
  scribble.addEventListener('click', () => onEdit(strip));
  // Canale che suona dal ritorno USB del computer invece che dall'ingresso: segnalato sulla strip.
  if (strip.source) mixer.on(`${base}/preamp/rtnsw`, usb => el.classList.toggle('usb-source', !!usb));

  // Pulsanti Gate / Comp / EQ: accesi se attivi, aprono il pannello di elaborazione.
  el.querySelectorAll('.proc-btn').forEach(btn => {
    mixer.on(`${base}/${btn.dataset.addr}`, on => btn.classList.toggle('active', !!on));
    btn.addEventListener('click', () => onProcess(strip, btn.dataset.tab));
  });
  const label = $('.label');
  if (editable) label.addEventListener('click', () => onProcess(strip));
  else label.disabled = true;

  // Fader
  const fader = $('.fader');
  const cap = $('.fader-cap');
  const dbText = $('.db-val');
  let faderAddr = null;
  let offFader = null;
  const showFader = v => {
    cap.style.setProperty('--v', v);
    const db = formatDb(faderToDb(v));
    if (dbText.textContent !== db) {
      dbText.textContent = db;
      fader.setAttribute('aria-valuetext', `${db} dB`);
    }
  };
  const bindFader = address => {
    offFader?.();
    faderAddr = address;
    offFader = address ? mixer.on(address, showFader) : null;
    if (!address) showFader(0);
  };
  bindFader(strip.fader);
  if (strip.sends) {
    el.setSend = n => {
      const available = n === null || n <= strip.sends;
      el.classList.toggle('send-mode', n !== null && available);
      el.classList.toggle('send-na', !available);
      bindFader(n === null ? strip.fader : available ? sendAddress(strip, n) : null);
    };
  }
  draggable(fader, {
    axis: 'y',
    reset: ZERO_DB,
    length: () => fader.clientHeight - cap.offsetHeight,
    getValue: () => mixer.get(faderAddr, 0),
    setValue: v => faderAddr && mixer.set(faderAddr, v),
    // mentre il dito è sul fader, i valori in arrivo dal mixer (in ritardo) non lo fanno saltare indietro
    onGrab: () => faderAddr && mixer.hold(faderAddr),
    onRelease: () => faderAddr && mixer.release(faderAddr),
  });

  // Pan (in link stereo diventa il bilanciamento della coppia)
  const linked = () => !!links?.isLinked(strip);
  let renderPan = () => {};
  if (strip.pan) {
    const pan = $('.pan');
    const panAddr = `${base}/mix/pan`;
    const getPan = () => (linked() ? links.balance(strip) : mixer.get(panAddr, 0.5));
    renderPan = () => {
      const v = getPan();
      pan.style.setProperty('--pan', v);
      $('.pan-val').textContent = linked() ? `BAL ${panLabel(v)}` : panLabel(v);
    };
    mixer.on(panAddr, renderPan);
    const partner = links?.pair(strip);
    if (partner) mixer.on(`${(partner.a === strip ? partner.b : partner.a).base}/mix/pan`, renderPan);
    renderPan();
    draggable(pan, {
      axis: 'x',
      reset: 0.5,
      length: () => pan.clientWidth * 1.5,
      getValue: getPan,
      setValue: v => (linked() ? links.setBalance(strip, v) : mixer.set(panAddr, v)),
    });
  }

  // Link stereo: la strip dispari rappresenta la coppia, quella pari viene nascosta.
  if (links?.pair(strip)) {
    const updateLink = () => {
      const on = linked();
      el.classList.toggle('linked', on && links.isPrimary(strip));
      el.classList.toggle('linked-hidden', on && !links.isPrimary(strip));
      label.textContent = on ? links.pairLabel(strip) : strip.label;
      renderPan();
    };
    links.onChange(updateLink);
    updateLink();
  }

  // Mute (mix/on = 0 significa canale spento)
  const mute = $('.mute');
  const onAddr = strip.on;
  mixer.on(onAddr, on => {
    mute.classList.toggle('active', !on);
    el.classList.toggle('muted', !on);
  });
  mute.addEventListener('click', () => mixer.set(onAddr, mixer.get(onAddr, 1) ? 0 : 1, 'i'));

  // Solo
  if (strip.solo) {
    const solo = $('.solo');
    const soloAddr = soloAddress(strip);
    mixer.on(soloAddr, v => solo.classList.toggle('active', !!v));
    solo.addEventListener('click', () => mixer.set(soloAddr, mixer.get(soloAddr, 0) ? 0 : 1, 'i'));
  }

  el.querySelectorAll('.meter').forEach((m, i) => registerMeter(m, [...strip.meters, strip.linkMeter][i]));
  return el;
}
