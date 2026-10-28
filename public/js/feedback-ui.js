// Interfaccia del rilevatore di feedback: pulsante in alto, pannello impostazioni/avvisi, notifiche.

import { SENSITIVITY, MODES } from './feedback.js';

const PREF_KEY = 'xair.feedback';
const TOAST_MS = 8000;

const formatFreq = f => (f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`);

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 2 ? 'ora' : s < 60 ? `${s} s fa` : `${Math.round(s / 60)} min fa`;
}

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function button(text, className, onClick) {
  const b = h('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export function createFeedbackUI({ mixer, monitor, editor, storage }) {
  const outputName = id => {
    const s = monitor.outputStrip(id);
    return mixer.get(`${s.base}/config/name`) || s.label;
  };

  // --- impostazioni salvate ---------------------------------------------------------------
  try {
    const saved = JSON.parse(storage.get(PREF_KEY) ?? 'null');
    if (saved) monitor.configure({ ...saved, outputs: saved.outputs?.filter(id => monitor.outputStrip(id)) ?? monitor.settings.outputs });
  } catch { /* impostazioni non valide: si usano quelle predefinite */ }
  const save = () => storage.set(PREF_KEY, JSON.stringify(monitor.settings));

  // --- pulsante in alto ------------------------------------------------------------------------
  const headerBtn = document.getElementById('fb-btn');
  const count = headerBtn.querySelector('.fb-count');

  // --- pannello ----------------------------------------------------------------------------------
  const dialog = h('dialog', 'fb-dialog');
  dialog.innerHTML = `
    <div class="dialog-head"><h2>Rilevatore feedback</h2><button class="icon-btn fb-close" type="button" aria-label="Chiudi">✕</button></div>
    <p class="fb-help">Sorveglia i livelli delle uscite e ne analizza lo spettro con l'RTA del mixer.
      Un picco stretto che resta alla stessa frequenza viene segnalato come feedback.</p>
    <div class="fb-settings">
      <button class="toggle big fb-enable" type="button">Monitoraggio</button>
      <div class="choice"><div class="choice-label">Modalità</div><div class="segmented fb-mode"></div></div>
      <div class="choice"><div class="choice-label">Sensibilità</div><div class="segmented fb-sens"></div></div>
      <button class="toggle fb-auto" type="button" title="Mette da solo un notch sull'EQ dell'uscita">Notch automatico</button>
    </div>
    <p class="fb-mode-help"></p>
    <div class="choice-label">Uscite controllate</div>
    <div class="fb-outputs"></div>
    <div class="fb-sim" hidden>
      <span>Simulatore:</span>
      <select class="fb-sim-out"></select>
      <button class="btn ghost fb-sim-btn" type="button">Simula feedback</button>
    </div>
    <div class="fb-list-head"><h3>Avvisi</h3><button class="btn ghost fb-clear" type="button">Svuota</button></div>
    <ul class="fb-list"></ul>`;
  document.body.append(dialog);
  const $ = sel => dialog.querySelector(sel);

  const enableBtn = $('.fb-enable');
  enableBtn.addEventListener('click', () => {
    monitor.configure({ enabled: !monitor.settings.enabled });
    save();
  });
  const autoBtn = $('.fb-auto');
  autoBtn.addEventListener('click', () => {
    monitor.configure({ autoNotch: !monitor.settings.autoNotch });
    save();
  });

  const MODE_HELP = {
    show: 'Concerto: con la musica. Note e armoniche non contano; il notch automatico interviene solo su picchi che durano, fermi e dominanti (al massimo 4 per uscita).',
    soundcheck: 'Soundcheck: per cercare il feedback a microfoni aperti, senza musica. Ogni picco che resta viene tagliato subito. Torna su Concerto prima di suonare.',
  };
  const modeEl = $('.fb-mode');
  for (const [key, { label }] of Object.entries(MODES)) {
    modeEl.append(button(label, '', () => {
      monitor.configure({ mode: key });
      save();
    }));
    modeEl.lastChild.dataset.key = key;
  }

  const sens = $('.fb-sens');
  for (const [key, { label }] of Object.entries(SENSITIVITY)) {
    sens.append(button(label, '', () => {
      monitor.configure({ sensitivity: key });
      save();
    }));
    sens.lastChild.dataset.key = key;
  }

  const outputsEl = $('.fb-outputs');
  const simOut = $('.fb-sim-out');
  for (const o of monitor.outputs) {
    const b = button('', 'toggle', () => {
      const set = new Set(monitor.settings.outputs);
      if (set.has(o.id)) set.delete(o.id);
      else set.add(o.id);
      monitor.configure({ outputs: [...set] });
      save();
    });
    b.dataset.id = o.id;
    outputsEl.append(b);
    simOut.add(new Option(o.label, o.id));
  }
  $('.fb-sim-btn').addEventListener('click', () => {
    mixer.t.send('/-sim/feedback', [{ type: 's', value: simOut.value }]);
  });

  $('.fb-close').addEventListener('click', () => dialog.close());
  $('.fb-clear').addEventListener('click', () => monitor.clear());
  headerBtn.addEventListener('click', () => {
    renderAll();
    dialog.showModal();
  });

  function notch(alert, onError) {
    try {
      monitor.applyNotch(alert);
    } catch (err) {
      onError(err.message);
    }
  }

  function alertRow(a) {
    const li = h('li', 'fb-alert');
    li.append(h('div', 'fb-freq', formatFreq(a.freq)));
    const meta = h('div', 'fb-meta');
    const parts = [`${Math.round(a.level)} dB`, `${a.count}×`, ago(a.last)];
    if (a.notch) parts.push(`notch banda ${a.notch.band}: ${a.notch.gain} dB`);
    meta.append(h('strong', null, outputName(a.output)), h('span', null, ` · ${parts.join(' · ')}`));
    const msg = h('div', 'fb-error');
    meta.append(msg);
    const actions = h('div', 'fb-actions');
    actions.append(
      button(a.notch ? 'Approfondisci' : 'Notch', 'btn', () => notch(a, m => { msg.textContent = m; })),
      button('EQ', 'btn ghost', () => {
        dialog.close();
        editor.open(monitor.outputStrip(a.output), 'eq');
      }),
      button('✕', 'btn ghost', () => monitor.dismiss(a)),
    );
    li.append(meta, actions);
    return li;
  }

  function renderAll() {
    const s = monitor.settings;
    enableBtn.setAttribute('aria-pressed', String(s.enabled));
    autoBtn.setAttribute('aria-pressed', String(s.autoNotch));
    sens.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.key === s.sensitivity)));
    modeEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.key === s.mode)));
    $('.fb-mode-help').textContent = MODE_HELP[s.mode] ?? MODE_HELP.show;
    outputsEl.querySelectorAll('button').forEach(b => {
      b.textContent = outputName(b.dataset.id);
      b.setAttribute('aria-pressed', String(s.outputs.includes(b.dataset.id)));
    });
    $('.fb-sim').hidden = !mixer.info?.name?.includes('SIM');

    const list = $('.fb-list');
    list.innerHTML = '';
    const alerts = monitor.activeAlerts();
    if (!alerts.length) list.append(h('li', 'hint', s.enabled ? 'Nessun feedback rilevato.' : 'Monitoraggio spento.'));
    alerts.forEach(a => list.append(alertRow(a)));
    renderHeader();
  }

  function renderHeader() {
    const active = monitor.activeAlerts().filter(a => Date.now() - a.last < 5000);
    headerBtn.dataset.state = !monitor.settings.enabled ? 'off' : active.length ? 'alert' : 'on';
    // promemoria visibile: in soundcheck il notch automatico taglia tutto quello che resta
    headerBtn.classList.toggle('soundcheck', monitor.settings.enabled && monitor.settings.mode === 'soundcheck');
    headerBtn.title = monitor.settings.mode === 'soundcheck' ? 'Rilevatore feedback (Soundcheck)' : 'Rilevatore feedback';
    count.textContent = active.length ? String(active.length) : '';
  }

  // --- notifiche --------------------------------------------------------------------------------
  const toasts = h('div', 'toasts');
  document.body.append(toasts);
  const toastFor = new Map(); // id avviso -> elemento

  function toast(alert, text) {
    let el = toastFor.get(alert.id);
    if (!el) {
      el = h('div', 'toast');
      toastFor.set(alert.id, el);
      toasts.prepend(el);
    }
    el.innerHTML = '';
    const msg = h('div', 'toast-msg');
    msg.append(h('strong', null, `Feedback ${formatFreq(alert.freq)}`), h('span', null, ` su ${outputName(alert.output)}`));
    if (text) msg.append(h('div', 'toast-sub', text));
    el.append(msg);
    if (!monitor.settings.autoNotch) {
      el.append(button(alert.notch ? 'Approfondisci' : 'Notch', 'btn', () => notch(alert, m => toast(alert, m))));
    }
    el.append(button('EQ', 'btn ghost', () => editor.open(monitor.outputStrip(alert.output), 'eq')));
    el.append(button('✕', 'btn ghost', () => removeToast(alert.id)));
    clearTimeout(el.timer);
    el.timer = setTimeout(() => removeToast(alert.id), TOAST_MS);
  }

  function removeToast(id) {
    toastFor.get(id)?.remove();
    toastFor.delete(id);
  }

  monitor.onChange(e => {
    if (e.type === 'alert') toast(e.alert);
    if (e.type === 'notch') toast(e.alert, `Notch banda ${e.alert.notch.band}: ${e.alert.notch.gain} dB`);
    if (dialog.open) renderAll();
    else renderHeader();
  });

  // Evidenzia per qualche secondo le strip delle uscite in feedback.
  setInterval(() => {
    renderHeader();
    for (const o of monitor.outputs) {
      const hot = monitor.alertsFor(o.id).some(a => Date.now() - a.last < 3000);
      document.querySelector(`.strip[data-id="${o.id}"]`)?.classList.toggle('feedback', hot);
    }
  }, 500);

  renderAll();
}
