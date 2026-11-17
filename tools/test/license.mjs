// Prove delle licenze: prova di 14 giorni, orologio spostato, accesso con codice, 3 dispositivi,
// funzionamento offline, gettoni falsificati o di un altro dispositivo, dispositivo tolto da un altro.
// Uso: cd tools/test && npm test

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { createLicense, TRIAL_DAYS } = await import(`${ROOT}/public/js/license.js`);
const { createLicenseServer, newKeyPair } = await import(`${ROOT}/server/license-server.js`);

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const DAY = 86_400_000;

const keys = await newKeyPair();
const mail = new Map();
let clock = Date.UTC(2026, 10, 14);
const server = await createLicenseServer({ privateJwk: keys.privateJwk, sendCode: (e, c) => mail.set(e, c), now: () => clock });
let online = true;
const net = (url, opts) => online ? server.fetchImpl(url, opts) : Promise.reject(new TypeError('offline'));

function memStorage() { const m = new Map(); return { get: k => m.get(k) ?? null, set: (k, v) => m.set(k, v), m }; }
const config = { enabled: true, apiBase: 'https://licenze.test', publicKeyJwk: keys.publicJwk };
function device(storage = memStorage(), opts = {}) {
  return createLicense({ storage, config, platform: 'ios', fetchImpl: net, now: () => clock, ...opts });
}
async function signIn(lic, email) {
  await lic.requestCode(email);
  await lic.login(mail.get(email));
}

await test('spenta: tutto libero', async () => {
  const lic = createLicense({ storage: memStorage(), config: { enabled: false } });
  await lic.init();
  assert(lic.state().kind === 'off' && lic.canControl(), 'dovrebbe essere libera');
});

await test('prova: parte al primo mixer, dura 14 giorni, poi si ferma', async () => {
  const lic = device();
  await lic.init();
  assert(lic.state().kind === 'trial-unstarted', 'non ancora partita');
  lic.startTrial();
  assert(lic.state().kind === 'trial' && lic.state().daysLeft === TRIAL_DAYS, 'appena partita');
  clock += 10 * DAY;
  assert(lic.state().daysLeft === 4 && lic.canControl(), '4 giorni rimasti');
  clock += 4 * DAY;
  assert(lic.state().kind === 'expired' && !lic.canControl(), 'finita');
  lic.startTrial();
  assert(lic.state().kind === 'expired', 'non riparte');
  clock -= 14 * DAY;
});

await test('prova: spostare indietro la data non la allunga', async () => {
  const s = memStorage();
  const lic = device(s);
  lic.startTrial();
  clock += 15 * DAY;
  assert(lic.state().kind === 'expired', 'finita');
  clock -= 15 * DAY; // l'utente rimette la data di due settimane fa
  const again = device(s);
  await again.init();
  assert(again.state().kind === 'expired', 'resta finita');
});

await test('accesso: codice sbagliato rifiutato, poi bloccato dopo 5 tentativi', async () => {
  const lic = device();
  await lic.requestCode('a@b.it');
  let err = null;
  try { await lic.login('000000' === mail.get('a@b.it') ? '111111' : '000000'); } catch (e) { err = e; }
  assert(err?.code === 'bad-code', 'codice sbagliato');
  for (let i = 0; i < 5; i++) { try { await lic.login('999999x'); } catch { /* atteso */ } }
  err = null;
  try { await lic.login(mail.get('a@b.it')); } catch (e) { err = e; }
  assert(err?.code === 'bad-code', 'dopo 5 errori il codice non vale più');
});

await test('account senza acquisto: no-license', async () => {
  const lic = device();
  await signIn(lic, 'nuovo@b.it');
  let err = null;
  try { await lic.activate(); } catch (e) { err = e; }
  assert(err?.code === 'no-license', err?.code);
});

const buyer = 'musicista@band.it';
server.grant(buyer);
const phones = [memStorage(), memStorage(), memStorage(), memStorage()];

await test('licenza: 3 dispositivi sì, il quarto trova i posti pieni', async () => {
  for (const s of phones.slice(0, 3)) {
    const lic = device(s);
    await signIn(lic, buyer);
    const list = await lic.activate();
    assert(lic.state().kind === 'licensed', 'attivo');
    assert(list.length <= 3, 'elenco');
  }
  const fourth = device(phones[3]);
  await signIn(fourth, buyer);
  let err = null;
  try { await fourth.activate(); } catch (e) { err = e; }
  assert(err?.code === 'limit' && err.data.devices.length === 3, 'posti pieni con elenco');
});

await test('licenza: funziona offline dopo l\'attivazione (anche al riavvio)', async () => {
  online = false;
  const lic = device(phones[0]);
  await lic.init();
  assert(lic.state().kind === 'licensed' && lic.canControl(), 'offline resta attiva');
  clock += 400 * DAY;
  await lic.init();
  assert(lic.state().kind === 'licensed', 'anche dopo un anno senza rete');
  online = true;
});

await test('licenza: liberare un posto, il dispositivo tolto perde la licenza al controllo', async () => {
  const fourth = device(phones[3]);
  const others = await fourth.devices();
  const first = device(phones[0]);
  await first.init();
  const firstId = first.deviceId();
  assert(others.some(d => d.id === firstId), 'il primo è in elenco');
  await fourth.removeDevice(firstId);
  await fourth.activate();
  assert(fourth.state().kind === 'licensed', 'il quarto ora è attivo');
  await first.check({ force: true });
  assert(first.state().kind !== 'licensed', 'il primo non è più attivo');
});

await test('sicurezza: gettone copiato da un altro dispositivo non vale', async () => {
  const stolen = memStorage();
  stolen.set('airdesk.license', phones[1].get('airdesk.license'));
  const lic = device(stolen);
  await lic.init();
  assert(lic.state().kind !== 'licensed', 'non deve valere su un altro dispositivo');
});

await test('sicurezza: gettone modificato o firmato con un\'altra chiave non vale', async () => {
  const s = memStorage();
  const lic = device(s);
  const id = lic.deviceId();
  const fake = Buffer.from(JSON.stringify({ v: 1, email: 'x@y.it', dev: id, iat: clock })).toString('base64url');
  const realSig = phones[1].get('airdesk.license').split('.')[1];
  s.set('airdesk.license', `${fake}.${realSig}`);
  await lic.init();
  assert(lic.state().kind !== 'licensed', 'firma di un altro contenuto');
  const other = await newKeyPair();
  const k = await webcrypto.subtle.importKey('jwk', other.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, Buffer.from(JSON.stringify({ v: 1, email: 'x@y.it', dev: id, iat: clock })))).toString('base64url');
  s.set('airdesk.license', `${fake}.${sig}`);
  await lic.init();
  assert(lic.state().kind !== 'licensed', 'chiave falsa');
});

await test('controllo silenzioso senza rete: non toglie la licenza', async () => {
  online = false;
  const lic = device(phones[1]);
  await lic.init();
  await lic.check({ force: true });
  assert(lic.state().kind === 'licensed', 'resta attiva');
  online = true;
});

await test('esci: libera il posto', async () => {
  const lic = device(phones[2]);
  await lic.init();
  const before = server.devices(buyer).length;
  await lic.signOut();
  assert(server.devices(buyer).length === before - 1 && lic.state().kind !== 'licensed', 'posto liberato');
});

if (failed) { console.log(`\n${failed} prove delle licenze FALLITE`); process.exit(1); }
console.log('\ntutte le prove delle licenze passate');
