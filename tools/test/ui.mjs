// Prove automatiche dell'interfaccia: l'app vera (public/) in jsdom, collegata al simulatore
// tramite il ponte, su porte di prova (simulatore 10031, ponte 8097) per non disturbare nulla.
// Uso: cd tools/test && npm install && npm test

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import WS from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIM_PORT = 10031;
const BRIDGE_PORT = 8097;
const { startSimulator } = await import(`${ROOT}/server/simulator.js`);
const { startBridge } = await import(`${ROOT}/server/bridge.js`);
const sim = startSimulator({ port: SIM_PORT });
const bridge = startBridge({ port: BRIDGE_PORT, host: '127.0.0.1', quiet: true });
const simValue = a => sim.state.get(a)?.value;

// --- finestra jsdom con quello che manca rispetto a un browser ---------------------------------
const html = fs.readFileSync(`${ROOT}/public/index.html`, 'utf8').replace(/<script type="module"[^>]*><\/script>/, '');
const dom = new JSDOM(html, { url: `http://localhost:${BRIDGE_PORT}/`, pretendToBeVisual: true });
const w = dom.window;
const errors = [];
w.addEventListener('error', e => errors.push(e.message));
process.on('unhandledRejection', e => errors.push(String(e)));
w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
w.HTMLDialogElement.prototype.close = function () { if (this.open) { this.open = false; this.dispatchEvent(new w.Event('close')); } };
w.Element.prototype.setPointerCapture = () => {};
w.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
w.HTMLCanvasElement.prototype.getContext = () => ctx;
// la porta del mixer nel messaggio di connessione diventa quella del simulatore di prova
class TestWS extends WS {
  send(d) {
    const m = JSON.parse(d);
    if (m.type === 'connect') m.port = SIM_PORT;
    super.send(JSON.stringify(m));
  }
}
for (const k of ['window', 'document', 'location', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'Option', 'navigator', 'getComputedStyle'])
  Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
globalThis.WebSocket = TestWS;
w.localStorage.setItem('xair.lastIp', '127.0.0.1');

await import(`${ROOT}/public/js/app.js`);

// --- strumenti ---------------------------------------------------------------------------------
const $ = s => w.document.querySelector(s);
const $$ = s => [...w.document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, ms = 8000, what = 'condizione') {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`tempo scaduto: ${what}`);
    await sleep(50);
  }
}
const pointer = (el, type, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: 10, clientY: y, button: 0 }));
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

// --- prove ------------------------------------------------------------------------------------
await test('connessione al simulatore', async () => {
  await until(() => $('#status').dataset.status === 'online', 8000, 'stato online');
  await until(() => $('.strip[data-id=ch1] .scribble').textContent !== 'Ch 1', 8000, 'nomi dei canali');
});

await test('fader: trascinamento arriva al mixer', async () => {
  const fader = $('.strip[data-id=ch1] .fader');
  Object.defineProperty(fader, 'clientHeight', { value: 300 });
  const before = simValue('/ch/01/mix/fader');
  pointer(fader, 'pointerdown', 200);
  for (let y = 198; y >= 150; y -= 2) pointer(fader, 'pointermove', y);
  await sleep(60); // un fotogramma per applicare l'ultimo movimento
  pointer(fader, 'pointerup', 150);
  await until(() => Math.abs(simValue('/ch/01/mix/fader') - before) > 0.1, 3000, 'valore nel simulatore');
  assert($('.strip[data-id=ch1] .db-val').textContent !== '', 'testo dB vuoto');
});

await test('fader: i valori in arrivo non lo fanno saltare mentre lo si tiene', async () => {
  const fader = $('.strip[data-id=ch2] .fader');
  Object.defineProperty(fader, 'clientHeight', { value: 300 });
  pointer(fader, 'pointerdown', 200);
  pointer(fader, 'pointermove', 140);
  await sleep(60);
  const shown = $('.strip[data-id=ch2] .db-val').textContent;
  // un altro dispositivo (qui: il simulatore) manda un valore diverso mentre il dito è sul fader
  const sock = (await import('node:dgram')).default.createSocket('udp4');
  const { encode } = await import(`${ROOT}/server/osc.js`);
  sock.send(encode('/ch/02/mix/fader', [{ type: 'f', value: 0.1 }]), SIM_PORT, '127.0.0.1');
  await sleep(300);
  sock.close();
  assert($('.strip[data-id=ch2] .db-val').textContent === shown, 'il fader è saltato');
  pointer(fader, 'pointerup', 140);
});

await test('schede senza errori', async () => {
  for (const g of ['bus', 'dca', 'fx', 'routing', 'meters', 'input']) {
    $(`.topbar .tab[data-group=${g}]`).click();
    await sleep(100);
  }
  assert($('#strips').dataset.group === 'input', 'scheda finale');
});

await test('Vista: nascondere e rimostrare canali', async () => {
  $('#view-btn').click();
  assert(!$('.view-channels').hidden, 'sezione Canali nascosta nel mixer principale');
  $$('.view-picks .toggle')[2].click();
  assert($('.strip[data-id=ch3]').classList.contains('user-hidden'), 'ch3 non nascosto');
  $('.view-all').click();
  assert(!$$('#strips .strip.user-hidden').length, 'canali ancora nascosti');
  $('.view-close').click();
});

await test('pannello canale: preset e schede', async () => {
  $('.strip[data-id=ch1] .label').click();
  assert(!$('.editor').hidden, 'pannello chiuso');
  assert($('.editor .preset-select'), 'menu dei preset mancante');
  for (const t of $$('.editor-tabs .tab')) { t.click(); await sleep(50); }
  $('.editor .close').click();
});

await test('monitor: entra ed esce', async () => {
  $('#monitor-btn').click();
  assert(!$('.monitor-view').hidden, 'monitor non aperto');
  $('.mon-view').click();
  assert($('.view-channels').hidden, 'Canali del mixer principale visibili nel monitor');
  $('.view-close').click();
  $('.mon-exit').click();
  assert($('.monitor-view').hidden, 'monitor non chiuso');
});

await test('nessun errore JavaScript', async () => {
  assert(!errors.length, errors.join(' | '));
});

console.log(failed ? `\n${failed} prove fallite` : '\ntutte le prove passate');
bridge.close();
sim.close();
process.exit(failed ? 1 : 0);
