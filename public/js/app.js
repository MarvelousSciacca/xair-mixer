import { WebSocketTransport } from './transport-ws.js';
import { UdpTransport } from './transport-udp.js';
import { Capacitor, registerPlugin } from '../vendor/capacitor-core.js';
import { Mixer } from './mixer.js';
import { buildStrips, stripAddresses, COLORS, MUTE_GROUPS, settingsAddresses } from './model.js';
import { createStrip, startMeterLoop, applyColor } from './ui.js';
import { stripParams } from './params.js';
import { createEditor, hasProcessing } from './editor.js';
import { fxAddresses, FX_SLOTS } from './fx.js';
import { createFxRack, fxInsertAddress } from './fx-rack.js';
import { createRouting } from './routing.js';
import { applyTheme } from './theme.js';
import { createView, createViewPanel, alignFaders } from './view.js';
import { createMeterPage } from './meters.js';
import { Links } from './link.js';
import { createMonitor } from './monitor.js';
import { createScenes } from './scenes.js';
import { createSettings } from './settings.js';
import { Rta } from './rta.js';
import { FeedbackMonitor } from './feedback.js';
import { createFeedbackUI } from './feedback-ui.js';

const LAST_IP_KEY = 'xair.lastIp';
const TAB_KEY = 'xair.tab';

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* non disponibile */ }
  },
};

applyTheme();
// Nell'app (Android) si parla al mixer in UDP nativo; nel browser tramite il ponte Node.
const native = Capacitor.isNativePlatform();
document.body.classList.toggle('native-app', native);
const transport = native ? new UdpTransport(registerPlugin('XAirUdp')) : new WebSocketTransport();
const mixer = new Mixer(transport);
const strips = buildStrips();
// Prima i parametri del mixer principale, poi quelli di elaborazione.
const allAddresses = [
  ...strips.flatMap(stripAddresses),
  ...MUTE_GROUPS,
  ...strips.flatMap(s => stripParams(s).map(p => p.address)),
  ...fxAddresses(),
];
const links = new Links(mixer, strips);
allAddresses.push(...links.addresses(), ...settingsAddresses(), ...FX_SLOTS.map(fxInsertAddress));
const rta = new Rta(mixer);
const feedback = new FeedbackMonitor(mixer, rta, strips);
const editor = createEditor(mixer, strips, { rta, feedback, links });

// --- strip --------------------------------------------------------------------

const stripsEl = document.getElementById('strips');
const mainEl = document.getElementById('main-strip');
const stripEls = new Map();
for (const s of strips) {
  const el = createStrip(mixer, s, { onEdit: openEditor, onProcess: editor.open, editable: hasProcessing(s), links });
  stripEls.set(s.id, el);
  (s.group === 'main' ? mainEl : stripsEl).append(el);
}
startMeterLoop(mixer);

// Interruttori dei mute group, nella scheda DCA.
const muteGroupsEl = document.createElement('div');
muteGroupsEl.className = 'strip strip-dca mute-groups';
muteGroupsEl.innerHTML = '<div class="mg-title">Mute group</div>';
MUTE_GROUPS.forEach((address, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mg-btn';
  b.textContent = `MG ${i + 1}`;
  mixer.on(address, on => b.classList.toggle('active', !!on));
  b.addEventListener('click', () => mixer.set(address, mixer.get(address, 0) ? 0 : 1, 'i'));
  muteGroupsEl.append(b);
});
stripsEl.append(muteGroupsEl);

// --- scheda Effetti ---------------------------------------------------------------------

createFxRack({
  mixer,
  container: document.querySelector('.mixer'),
  onSends: slot => selectFaderTarget(6 + slot),
  onEditReturn: slot => editor.open(strips.find(s => s.id === `rtn${slot}`), 'eq'),
});

// --- fader sulle mandate ("sends on fader") ----------------------------------------------

const faderTarget = document.getElementById('fader-target');
const sendBanner = document.getElementById('send-banner');
for (let n = 1; n <= 10; n++) {
  const fallback = n <= 6 ? `Bus ${n}` : `FX ${n - 6}`;
  const option = new Option(fallback, n);
  faderTarget.add(option);
  mixer.on(n <= 6 ? `/bus/${n}/config/name` : `/fxsend/${n - 6}/config/name`, name => {
    option.text = name || fallback;
    if (Number(faderTarget.value) === n) setFaderTarget(n);
  });
}
function setFaderTarget(n) {
  for (const s of strips) stripEls.get(s.id).setSend?.(n);
  const target = n === null ? null : n <= 6 ? `bus${n}` : `fxsend${n - 6}`;
  for (const [id, el] of stripEls) el.classList.toggle('send-target', id === target);
  document.body.classList.toggle('sends-on-fader', n !== null);
  sendBanner.textContent = n === null ? '' : `I fader dei canali regolano le mandate verso ${faderTarget.selectedOptions[0].text}`;
}
/** Sceglie dove agiscono i fader dei canali: null = Main LR, 1-6 bus, 7-10 effetti. */
function selectFaderTarget(n) {
  faderTarget.value = n === null ? '' : String(n);
  if (n !== null) showTab('input');
  setFaderTarget(n);
}
faderTarget.addEventListener('change', () => selectFaderTarget(faderTarget.value ? Number(faderTarget.value) : null));

// --- schede ---------------------------------------------------------------------

const tabs = document.querySelectorAll('.topbar .tab');
let meterPage = null; // la pagina Meter chiede l'RTA al mixer solo quando è visibile
function showTab(group) {
  stripsEl.dataset.group = group;
  document.body.dataset.tab = group;
  tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.group === group)));
  storage.set(TAB_KEY, group);
  meterPage?.setVisible(group === 'meters');
  requestAnimationFrame(() => alignFaders());
}
tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.group)));
createRouting({ mixer, strips, container: document.querySelector('.mixer') });
meterPage = createMeterPage({ mixer, strips, rta, container: document.querySelector('.mixer') });
const view = createView({ mixerEl: document.querySelector('.mixer'), stripsEl });
const viewPanel = createViewPanel(view, { channels: strips.filter(s => s.group === 'input'), mixer, links });
document.getElementById('view-btn').addEventListener('click', () => viewPanel.open({ channels: true }));
showTab(['bus', 'dca', 'fx', 'routing', 'meters'].includes(storage.get(TAB_KEY)) ? storage.get(TAB_KEY) : 'input');

// --- stato connessione --------------------------------------------------------------

const statusEl = document.getElementById('status');
const STATUS_TEXT = {
  disconnected: 'Non connesso',
  connecting: 'Connessione…',
  online: 'Connesso',
  lost: 'Mixer non risponde',
};
// versione breve per i telefoni in verticale (la barra non ha posto per la frase intera)
const STATUS_SHORT = { disconnected: 'Offline', connecting: 'Attendi…', online: 'Online', lost: 'Perso' };
mixer.onStatus((status, info) => {
  statusEl.dataset.status = status;
  const name = info ? `${info.name} · ${info.model}` : mixer.ip ?? '';
  statusEl.querySelector('.status-text').textContent = STATUS_TEXT[status];
  statusEl.querySelector('.status-short').textContent = STATUS_SHORT[status];
  statusEl.title = `${STATUS_TEXT[status]}${name && status !== 'disconnected' ? ` · ${name}` : ''}`;
  statusEl.querySelector('.status-name').textContent = status === 'disconnected' ? '' : name;
  document.body.classList.toggle('offline', status !== 'online');
  // pulsante pieno solo quando c'è da collegarsi: da connessi diventa un tasto come gli altri
  document.getElementById('connect-btn').classList.toggle('ghost', status === 'online');
});
let bridgeWasDown = false;
transport.onStatus = s => {
  document.body.classList.toggle('bridge-down', s === 'closed');
  // Il ponte è ripartito dopo un'interruzione: nuova sessione UDP, si rilegge tutto.
  if (s === 'open' && bridgeWasDown && mixer.ip) mixer.resubscribe();
  if (s === 'closed') bridgeWasDown = true;
};

// --- finestra connessione --------------------------------------------------------------

const connectDialog = document.getElementById('connect-dialog');
const foundList = document.getElementById('found-list');
const ipInput = document.getElementById('ip-input');

async function connectTo(ip) {
  storage.set(LAST_IP_KEY, ip);
  connectDialog.close();
  await mixer.connect(ip, allAddresses);
}

async function scan() {
  foundList.innerHTML = '<li class="hint">Ricerca in corso…</li>';
  let mixers = [];
  try {
    mixers = await transport.discover();
  } catch (err) {
    foundList.innerHTML = `<li class="hint">${err.message}</li>`;
    return;
  }
  foundList.innerHTML = '';
  if (!mixers.length) {
    foundList.innerHTML = '<li class="hint">Nessun mixer trovato. Controlla che sia sulla stessa rete o inserisci l’IP.</li>';
    return;
  }
  for (const m of mixers) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'found';
    btn.innerHTML = `<strong></strong><span></span>`;
    btn.querySelector('strong').textContent = m.name;
    btn.querySelector('span').textContent = `${m.model} · ${m.ip} · firmware ${m.version}`;
    btn.addEventListener('click', () => connectTo(m.ip));
    li.append(btn);
    foundList.append(li);
  }
}

document.getElementById('connect-btn').addEventListener('click', () => {
  ipInput.value = storage.get(LAST_IP_KEY) ?? '';
  connectDialog.showModal();
  scan();
});
document.getElementById('scan-btn').addEventListener('click', scan);
document.getElementById('disconnect-btn').addEventListener('click', () => {
  mixer.disconnect();
  connectDialog.close();
});
document.getElementById('ip-form').addEventListener('submit', e => {
  e.preventDefault();
  const ip = ipInput.value.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) connectTo(ip);
  else ipInput.setCustomValidity('Inserisci un indirizzo IP, es. 192.168.1.50');
  ipInput.reportValidity();
});
ipInput.addEventListener('input', () => ipInput.setCustomValidity(''));

// --- editor nome/colore ---------------------------------------------------------------

const editDialog = document.getElementById('edit-dialog');
const editName = document.getElementById('edit-name');
const swatches = document.getElementById('swatches');
let editing = null;

COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.title = c.name;
  b.dataset.index = i;
  applyColor(b, i);
  b.addEventListener('click', () => {
    swatches.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-pressed', String(s === b)));
  });
  swatches.append(b);
});

function openEditor(strip) {
  editing = strip;
  document.getElementById('edit-title').textContent = strip.label;
  editName.value = mixer.get(`${strip.base}/config/name`, '');
  const color = mixer.get(`${strip.base}/config/color`, 0);
  swatches.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-pressed', String(Number(s.dataset.index) === color)));
  editDialog.showModal();
}

document.getElementById('edit-cancel').addEventListener('click', () => editDialog.close());
document.getElementById('edit-form').addEventListener('submit', e => {
  if (e.submitter?.value !== 'save' || !editing) return;
  mixer.set(`${editing.base}/config/name`, editName.value.slice(0, 12), 's');
  const selected = swatches.querySelector('[aria-pressed="true"]');
  if (selected) mixer.set(`${editing.base}/config/color`, Number(selected.dataset.index), 'i');
});

// --- rilevatore feedback ------------------------------------------------------------

createFeedbackUI({ mixer, monitor: feedback, editor, storage });

// --- modalità monitor (in-ear) -------------------------------------------------------------

const monitorView = createMonitor({ mixer, strips, links, editor, storage, view, viewPanel });
document.getElementById('monitor-btn').addEventListener('click', () => monitorView.enter());

// --- scene, snapshot e impostazioni -------------------------------------------------------------

const scenes = createScenes({ mixer, addresses: allAddresses, onReload: () => mixer.resubscribe() });
document.getElementById('scenes-btn').addEventListener('click', () => scenes.open());
const settings = createSettings({ mixer, addresses: allAddresses, onReload: () => mixer.resubscribe() });
document.getElementById('settings-btn').addEventListener('click', () => settings.open());

// --- avvio ------------------------------------------------------------------------

// ?ip=192.168.1.9 nell'indirizzo collega subito a quel mixer (link salvati, prove automatiche)
const urlIp = new URLSearchParams(location.search).get('ip');
const lastIp = /^[\d.]+$/.test(urlIp ?? '') ? urlIp : storage.get(LAST_IP_KEY);
if (lastIp) mixer.connect(lastIp, allAddresses);
else document.getElementById('connect-btn').click();
