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
const bridge = startBridge({ port: BRIDGE_PORT, host: '127.0.0.1', quiet: true, mixerPort: SIM_PORT });
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
for (const k of ['window', 'document', 'location', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'Option', 'navigator', 'getComputedStyle'])
  Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
globalThis.WebSocket = WS;
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
// MouseEvent senza pointerType: per l'app vale come un dito (zona morta e doppio tocco attivi)
const pointer = (el, type, y, x = 10) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
const near = (a, b, tol = 0.005) => Math.abs(a - b) < tol;
const drag = async (el, from, to, x = 10, gap = 0) => {
  pointer(el, 'pointerdown', from);
  if (x !== 10) pointer(el, 'pointermove', from, x);
  for (let y = from - 2; y >= to; y -= 2) {
    pointer(el, 'pointermove', y, x);
    if (gap) await sleep(gap); // movimenti su più fotogrammi, come un dito vero
  }
  await sleep(60);
  pointer(el, 'pointerup', to, x);
};
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
  $$('.view-dialog .view-picks .toggle')[2].click();
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

await test('annulla e ripeti: un trascinamento è un solo passo', async () => {
  const fader = $('.strip[data-id=ch3] .fader');
  Object.defineProperty(fader, 'clientHeight', { value: 300 });
  const before = simValue('/ch/03/mix/fader');
  await drag(fader, 200, 120, 10, 25);
  await until(() => Math.abs(simValue('/ch/03/mix/fader') - before) > 0.1, 3000, 'trascinamento nel simulatore');
  const after = simValue('/ch/03/mix/fader');
  assert(!$('#undo-btn').disabled, 'Annulla disattivato');
  $('#undo-btn').click();
  await until(() => near(simValue('/ch/03/mix/fader'), before), 3000, 'valore di partenza dopo Annulla');
  assert(!$('#redo-btn').disabled, 'Ripeti disattivato');
  $('#redo-btn').click();
  await until(() => near(simValue('/ch/03/mix/fader'), after), 3000, 'valore finale dopo Ripeti');
  // da tastiera
  w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await until(() => near(simValue('/ch/03/mix/fader'), before), 3000, 'Ctrl+Z');
  assert($('#redo-btn').disabled === false, 'Ripeti dopo Ctrl+Z');
});

await test('mute: Annulla lo riaccende', async () => {
  const mute = $('.strip[data-id=ch6] .mute');
  const before = simValue('/ch/06/mix/on');
  mute.click();
  await until(() => simValue('/ch/06/mix/on') !== before, 3000, 'mute nel simulatore');
  $('#undo-btn').click();
  await until(() => simValue('/ch/06/mix/on') === before, 3000, 'mute annullato');
});

await test('movimento fine: dito allontanato di lato', async () => {
  const fader = $('.strip[data-id=ch4] .fader');
  Object.defineProperty(fader, 'clientHeight', { value: 300 });
  const before = simValue('/ch/04/mix/fader');
  await drag(fader, 200, 150, 210); // 50 px in su, 200 px di lato: un quinto della corsa normale
  await until(() => !near(simValue('/ch/04/mix/fader'), before, 0.001), 3000, 'movimento nel simulatore');
  const delta = simValue('/ch/04/mix/fader') - before;
  assert(delta > 0.015 && delta < 0.06, `spostamento ${delta.toFixed(3)} invece di circa 0.03`);
  assert(!fader.classList.contains('fine'), 'segnale "fine" rimasto dopo il rilascio');
});

await test('doppio tocco: fader a 0 dB', async () => {
  const fader = $('.strip[data-id=ch5] .fader');
  await drag(fader, 200, 100);
  await until(() => !near(simValue('/ch/05/mix/fader'), 0.75), 3000, 'fader spostato');
  for (let i = 0; i < 2; i++) {
    pointer(fader, 'pointerdown', 100);
    pointer(fader, 'pointerup', 100);
  }
  await until(() => near(simValue('/ch/05/mix/fader'), 0.75), 3000, 'fader a 0 dB');
});

await test('blocco: ferma la tastiera e si sblocca tenendo premuto', async () => {
  $('#lock-btn').click();
  assert(!$('#lock-overlay').hidden && w.document.body.classList.contains('locked'), 'non bloccato');
  const before = simValue('/ch/03/mix/fader');
  w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
  await sleep(200);
  assert(near(simValue('/ch/03/mix/fader'), before), 'Ctrl+Y ha agito con i comandi bloccati');
  const pill = $('#unlock-btn');
  pointer(pill, 'pointerdown', 10);
  await sleep(300);
  pointer(pill, 'pointerup', 10);
  assert(!$('#lock-overlay').hidden, 'sbloccato con un tocco breve');
  pointer(pill, 'pointerdown', 10);
  await sleep(950);
  assert($('#lock-overlay').hidden && !w.document.body.classList.contains('locked'), 'non sbloccato tenendo premuto');
});

// messaggi diretti al simulatore, come da un altro dispositivo
const { encode: oscEncode } = await import(`${ROOT}/server/osc.js`);
const udp = (await import('node:dgram')).default.createSocket('udp4');
const simSend = (address, type, value) => udp.send(oscEncode(address, value === undefined ? [] : [{ type, value }]), SIM_PORT, '127.0.0.1');
const confirmAsk = () => $('dialog.ask-dialog[open] button[type=submit]').click();

await test('copia/incolla: gate ed EQ da un canale all\'altro, mai la +48V', async () => {
  simSend('/ch/09/gate/thr', 'f', 0.31);
  simSend('/ch/09/eq/2/g', 'f', 0.8);
  simSend('/headamp/09/phantom', 'i', 1);
  simSend('/headamp/10/phantom', 'i', 0);
  await sleep(400);
  $('.strip[data-id=ch9] .label').click();
  $('.editor .ed-copy').click();
  assert($('.editor .ed-paste').disabled, 'Incolla attivo sullo stesso canale');
  $('.editor .next').click();
  assert(!$('.editor .ed-paste').disabled, 'Incolla disattivato sul canale successivo');
  $('.editor .ed-paste').click();
  assert($('dialog.paste-dialog[open]'), 'finestra Incolla non aperta');
  confirmAsk();
  await until(() => near(simValue('/ch/10/gate/thr'), 0.31) && near(simValue('/ch/10/eq/2/g'), 0.8), 3000, 'gate ed EQ incollati');
  assert(simValue('/headamp/10/phantom') === 0, '+48V incollata');
  $('#undo-btn').click(); // un solo passo annulla tutto l'incolla
  await until(() => !near(simValue('/ch/10/gate/thr'), 0.31) && !near(simValue('/ch/10/eq/2/g'), 0.8), 3000, 'incolla annullato');
  $('.editor .close').click();
});

await test('canali protetti: lo snapshot non tocca il canale protetto', async () => {
  simSend('/-snap/save', 'i', 1);
  await sleep(200);
  simSend('/-snap/01/name', 's', 'Prova');
  await sleep(200);
  const f7 = $('.strip[data-id=ch7] .fader'), f8 = $('.strip[data-id=ch8] .fader');
  [f7, f8].forEach(f => Object.defineProperty(f, 'clientHeight', { value: 300 }));
  const snap7 = simValue('/ch/07/mix/fader'), snap8 = simValue('/ch/08/mix/fader');
  await drag(f7, 250, 150);
  await drag(f8, 250, 150);
  await until(() => !near(simValue('/ch/07/mix/fader'), snap7) && !near(simValue('/ch/08/mix/fader'), snap8), 3000, 'fader spostati');
  const moved7 = simValue('/ch/07/mix/fader');
  $('#scenes-btn').click();
  $('.scenes-dialog .tab[data-tab=safe]').click();
  [...$$('.sc-safe-groups .toggle')].find(b => b.textContent === $('.strip[data-id=ch7] .scribble').textContent).click();
  assert($('.sc-safe-note').textContent.includes($('.strip[data-id=ch7] .scribble').textContent), 'nota dei protetti mancante');
  $('.scenes-dialog .tab[data-tab=snap]').click();
  await until(() => !$$('.sc-row')[0].querySelector('.btn').disabled, 3000, 'snapshot 1 caricabile');
  $$('.sc-row')[0].querySelector('.btn').click();
  confirmAsk();
  await until(() => near(simValue('/ch/08/mix/fader'), snap8), 3000, 'ch8 tornato allo snapshot');
  await sleep(1200);
  assert(near(simValue('/ch/07/mix/fader'), moved7), `ch7 protetto cambiato (${simValue('/ch/07/mix/fader')} invece di ${moved7})`);
  $('.scenes-dialog .sc-close').click();
  udp.close();
});

await test('layer: nuova pagina con i canali scelti, nell\'ordine scelto', async () => {
  $('.tab-add').click();
  assert($('dialog.layer-dialog[open]'), 'finestra del layer non aperta');
  $('.ly-name').value = 'Voci';
  const pick = id => [...$$('.ly-pick')].find(b => b.textContent === $(`.strip[data-id=${id}] .scribble`).textContent).click();
  pick('ch13'); pick('ch2'); pick('bus1'); pick('dca1');
  $('.layer-dialog .ly-save').click();
  const tab = $('.tab-layer');
  assert(tab && tab.textContent === 'Voci', 'scheda del layer mancante');
  assert($('#strips').dataset.group === 'layer', 'layer non aperto');
  const shown = $$('#strips .strip.in-layer').sort((a, b) => a.style.order - b.style.order).map(e => e.dataset.id);
  assert(shown.join() === 'ch13,ch2,bus1,dca1', `ordine sbagliato: ${shown}`);
  assert(w.localStorage.getItem('xair.layers').includes('Voci'), 'layer non salvato');
  // secondo tocco sulla scheda aperta: modifica, poi elimina
  tab.click();
  assert($('dialog.layer-dialog[open]'), 'modifica non aperta');
  $('.ly-delete').click();
  assert(!$('.tab-layer') && $('#strips').dataset.group === 'input', 'layer non eliminato');
});

await test('nessun errore JavaScript', async () => {
  assert(!errors.length, errors.join(' | '));
});

console.log(failed ? `\n${failed} prove fallite` : '\ntutte le prove passate');
bridge.close();
sim.close();
process.exit(failed ? 1 : 0);
