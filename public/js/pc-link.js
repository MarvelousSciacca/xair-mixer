// Collegamento tramite computer.
// - App per computer: "Condividi con telefoni" accende il ripetitore (server/relay.js) e mostra un codice QR
//   con gli indirizzi del computer e un codice di 8 caratteri.
// - App per telefono: "Collegati tramite computer" inquadra il QR con la fotocamera (o si scrivono
//   indirizzo e codice a mano). Poi il computer si usa come un mixer: stesso UDP nativo, più il saluto
//   con il codice (transport-udp.js).
// - QR del musicista (pulsante Musicista nel monitor): lo stesso QR, più il bus e i canali. Chi lo inquadra
//   si collega (al computer, o direttamente al mixer) e si ritrova solo quel mix, già bloccato.

import { t } from './i18n.js';
import { ask } from './dialogs.js';

const SHARE_KEY = 'airdesk.shareKey';
const SHARE_ON = 'airdesk.shareOn';
const PC_KEYS = 'airdesk.pcKeys'; // { indirizzo del computer: codice }
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // come server/relay.js: niente 0/O, 1/I/L
const SCAN_EVERY_MS = 200;

export const validKey = key => /^[A-Z2-9]{8}$/.test(key ?? '');
const validIp = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip ?? '') && ip.split('.').every(n => Number(n) <= 255);

export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

// monitor del musicista: &mon=<bus>&c=<canali>. I canali sono una maschera di bit in esadecimale
// (ch1…ch16, aux, rtn1…rtn4: al massimo 6 caratteri), così il QR resta rado e si legge anche al buio.
const CHANNELS = [...Array.from({ length: 16 }, (_, i) => `ch${i + 1}`), 'aux', 'rtn1', 'rtn2', 'rtn3', 'rtn4'];
const maskOf = ids => CHANNELS.reduce((m, id, i) => (ids.includes(id) ? m + 2 ** i : m), 0).toString(16);
const idsOf = hex => (/^[0-9a-f]{1,6}$/i.test(hex ?? '') ? CHANNELS.filter((_, i) => Math.floor(parseInt(hex, 16) / 2 ** i) % 2) : []);
const monParams = mon => {
  if (!mon) return '';
  const all = !mon.ch?.length || CHANNELS.every(id => mon.ch.includes(id));
  return `&mon=${mon.bus}${all ? '' : `&c=${maskOf(mon.ch)}`}`;
};
/** Testo del QR del computer: airdesk://pc?ip=<indirizzi separati da virgola>&k=<codice>[&mon=…] */
export const linkText = (ips, key, mon = null) => `airdesk://pc?ip=${ips.join(',')}&k=${key}${monParams(mon)}`;
/** Testo del QR che porta direttamente al mixer (fonico collegato al mixer senza computer). */
export const mixerLinkText = (ip, mon = null) => `airdesk://mixer?ip=${ip}${monParams(mon)}`;

/**
 * Legge il testo del QR: { kind: 'pc', ips, key, mon } o { kind: 'mixer', ips: [ip], mon },
 * oppure null se non è un codice di AirDesk. mon: { bus, ch } o null.
 */
export function parseLink(text) {
  let url;
  try {
    url = new URL(String(text).trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'airdesk:') return null;
  const ips = (url.searchParams.get('ip') ?? '').split(',').filter(validIp).slice(0, 8);
  const bus = Number(url.searchParams.get('mon'));
  const ch = idsOf(url.searchParams.get('c'));
  const mon = Number.isInteger(bus) && bus >= 1 && bus <= 6 ? { bus, ch } : null;
  if (url.host === 'mixer') return ips.length ? { kind: 'mixer', ips: ips.slice(0, 1), mon } : null;
  const key = (url.searchParams.get('k') ?? '').toUpperCase();
  return url.host === 'pc' && ips.length && validKey(key) ? { kind: 'pc', ips, key, mon } : null;
}

const readKeys = storage => {
  try {
    const o = JSON.parse(storage.get(PC_KEYS) ?? '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
};

/** All'avvio dell'app per telefono: i codici dei computer già usati, così si ricollega da sola. */
export function loadPcKeys(udp, storage) {
  for (const [ip, key] of Object.entries(readKeys(storage))) if (validIp(ip) && validKey(key)) udp.keys.set(ip, key);
}

/** QR come SVG: moduli neri su bianco (i lettori vogliono scuro su chiaro), margine di 4 moduli. */
async function qrSvg(text) {
  const { default: qrcode } = await import('../vendor/qrcode.js');
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), m = 4, size = n + 2 * m;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// --- app per computer: condivisione ----------------------------------------------------------

function initShare({ ws, storage, mixer, connectDialog }) {
  const row = document.getElementById('share-row');
  const dialog = document.getElementById('share-dialog');
  const qr = document.getElementById('share-qr');
  const ipsEl = document.getElementById('share-ips');
  const keyEl = document.getElementById('share-key');
  const statusEl = document.getElementById('share-status');
  let state = { on: false };
  let shownText = '';

  const key = () => {
    let k = storage.get(SHARE_KEY);
    if (!validKey(k)) storage.set(SHARE_KEY, (k = newKey()));
    return k;
  };

  async function render() {
    if (!dialog.open) return;
    const lines = [];
    if (state.error === 'busy') lines.push(t('La porta UDP 10024 di questo computer è già usata da un altro programma: chiudilo e riprova.'));
    else if (state.error) lines.push(t('Condivisione non riuscita. Riprova.'));
    else if (!state.on) lines.push(t('Condivisione in avvio…'));
    else {
      const n = state.clients ?? 0;
      lines.push(n === 0 ? t('Nessun telefono collegato') : n === 1 ? t('1 telefono collegato') : t('{0} telefoni collegati', n));
      if (mixer.status !== 'online') lines.push(t('Questo computer non è collegato a un mixer: collegalo, i telefoni useranno quello.'));
    }
    statusEl.textContent = lines.join(' ');
    const ips = state.on ? state.ips ?? [] : [];
    ipsEl.textContent = ips.length ? ips.join(' · ') : '—';
    keyEl.textContent = state.on ? state.key : '—';
    dialog.querySelector('#share-stop').disabled = !state.on;
    const text = state.on && ips.length ? linkText(ips, state.key) : '';
    if (text === shownText) return;
    shownText = text;
    if (!text) {
      qr.innerHTML = '';
      qr.hidden = true;
      return;
    }
    const svg = await qrSvg(text);
    if (shownText === text) {
      qr.innerHTML = svg; // disegnato qui da indirizzi IP e codice già controllati
      qr.firstElementChild.setAttribute('aria-label', t('Codice QR per collegare i telefoni'));
      qr.hidden = false;
    }
  }

  ws.onShare = m => {
    if (m.type === 'hello') {
      row.hidden = !m.canShare;
      state = { on: false };
      // condivisione accesa l'ultima volta: riparte da sola (anche dopo un riavvio del ponte)
      if (m.canShare && storage.get(SHARE_ON) === '1') ws.share(true, key());
    } else {
      state = m;
    }
    render();
  };
  mixer.onStatus(() => render());
  const start = newCode => {
    if (newCode) storage.set(SHARE_KEY, newKey());
    storage.set(SHARE_ON, '1');
    state = { on: false };
    ws.share(true, key());
    render();
  };

  document.getElementById('share-btn').addEventListener('click', () => {
    connectDialog.close();
    dialog.showModal();
    if (!state.on) start(false);
    else render();
  });
  document.getElementById('share-stop').addEventListener('click', () => {
    storage.set(SHARE_ON, '0');
    ws.share(false);
    dialog.close();
  });
  document.getElementById('share-new').addEventListener('click', async () => {
    const ok = await ask({
      title: t('Nuovo codice'),
      message: t('I telefoni collegati con il codice di adesso si scollegano e dovranno inquadrare di nuovo il QR.'),
      confirmText: t('Cambia codice'),
    });
    if (ok) start(true);
  });
  document.getElementById('share-close').addEventListener('click', () => dialog.close());

  /** Accende la condivisione se serve (QR del musicista) e aspetta che sia pronta: lo stato finale. */
  async function ensureOn() {
    if (!state.on) start(false);
    for (let i = 0; i < 30 && !state.on && !state.error; i++) await new Promise(r => setTimeout(r, 100));
    return state;
  }
  return { render, ensureOn };
}

// --- app per telefono: collegamento a un computer --------------------------------------------

function initLink({ udp, storage, connectTo, connectDialog, openMonitor }) {
  const row = document.getElementById('pc-row');
  const dialog = document.getElementById('pc-dialog');
  const video = document.getElementById('pc-video');
  const camera = dialog.querySelector('.qr-camera');
  const statusEl = document.getElementById('pc-status');
  const ipInput = document.getElementById('pc-ip');
  const keyInput = document.getElementById('pc-key');
  let stream = null;
  let timer = null;
  let busy = false;
  row.hidden = false;

  const say = text => { statusEl.textContent = text; };

  function stopCamera() {
    clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach(tr => tr.stop());
    stream = null;
    video.srcObject = null;
    camera.hidden = true;
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      say(t('Fotocamera non disponibile: scrivi indirizzo e codice qui sotto.'));
      return;
    }
    say(t('Inquadra il codice QR mostrato sul computer.'));
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (err) {
      say(err?.name === 'NotAllowedError'
        ? t('Accesso alla fotocamera negato: permettilo nelle impostazioni del telefono, oppure scrivi indirizzo e codice qui sotto.')
        : t('Fotocamera non disponibile: scrivi indirizzo e codice qui sotto.'));
      return;
    }
    if (!dialog.open) return stopCamera();
    camera.hidden = false;
    video.srcObject = stream;
    video.play?.().catch(() => {});
    const { default: jsQR } = await import('../vendor/jsqr.js');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    timer = setInterval(() => {
      if (busy || !video.videoWidth) return;
      // immagine rimpicciolita: il QR resta leggibile e il telefono non scalda
      const scale = Math.min(1, 480 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (!code?.data) return;
      const link = parseLink(code.data);
      if (link?.kind === 'mixer') {
        // QR del fonico collegato direttamente al mixer: niente computer di mezzo
        stopCamera();
        dialog.close();
        connectTo(link.ips[0]);
        if (link.mon) openMonitor(link.mon);
      } else if (link) linkTo(link.ips, link.key, link.mon);
      else say(t('Questo non è un codice di AirDesk. Inquadra quello mostrato da AirDesk sul computer.'));
    }, SCAN_EVERY_MS);
  }

  /** Prova gli indirizzi del computer (Wi-Fi, cavo…) e si collega al primo che risponde con il codice. */
  async function linkTo(ips, key, mon = null) {
    if (busy) return;
    busy = true;
    say(t('Collegamento al computer…'));
    const answers = await Promise.all(ips.map(ip => udp.probeRelay(ip, key).then(status => ({ ip, status }))));
    busy = false;
    const ok = answers.find(a => a.status === 'ok');
    if (ok) {
      const keys = readKeys(storage);
      keys[ok.ip] = key;
      storage.set(PC_KEYS, JSON.stringify(keys));
      udp.keys.set(ok.ip, key);
      stopCamera();
      dialog.close();
      connectTo(ok.ip);
      if (mon) openMonitor(mon);
      return;
    }
    if (answers.some(a => a.status === 'no-mixer')) say(t('Il computer risponde ma non è collegato a un mixer: collegalo dal computer e riprova.'));
    else if (answers.some(a => a.status === 'bad-key')) say(t('Codice sbagliato: sul computer potrebbe essere cambiato. Inquadra di nuovo il QR.'));
    else say(t('Il computer non risponde. Telefono e computer devono essere sulla stessa rete Wi-Fi, con la condivisione accesa sul computer e il firewall che permette ad AirDesk le connessioni in entrata.'));
  }

  document.getElementById('pc-btn').addEventListener('click', () => {
    connectDialog.close();
    say('');
    keyInput.value = '';
    dialog.showModal();
    startCamera();
  });
  dialog.addEventListener('close', stopCamera);
  document.getElementById('pc-form').addEventListener('submit', e => {
    e.preventDefault();
    const ip = ipInput.value.trim();
    const key = keyInput.value.trim().toUpperCase().replace(/[\s-]/g, '');
    if (!validIp(ip)) return say(t('Inserisci l’indirizzo mostrato sul computer, es. 192.168.1.10'));
    if (!validKey(key)) return say(t('Il codice è di 8 caratteri, come mostrato sul computer.'));
    linkTo([ip], key);
  });

  // computer che cambia stato mentre il telefono è collegato
  let lastStatus = 'ok';
  udp.onRelay = status => {
    if (status === lastStatus) return;
    lastStatus = status;
    if (status === 'bad-key') {
      ask({ title: t('Codice cambiato'), message: t('Sul computer il codice è cambiato: inquadra di nuovo il QR.'), confirmText: t('Ho capito'), info: true });
    } else if (status === 'no-mixer') {
      ask({ title: t('Computer senza mixer'), message: t('Il computer non è più collegato al mixer. Ricollegalo dal computer: il telefono riprende da solo.'), confirmText: t('Ho capito'), info: true });
    }
  };
  return { linkTo };
}

/**
 * native: app per telefono (UdpTransport) o per computer/browser (WebSocketTransport).
 * Nel browser normale il ponte non offre la condivisione e i pulsanti restano nascosti.
 */
export function initPcLink({ native, realTransport, storage, mixer, connectTo, connectDialog, isOffline, openMonitor }) {
  const share = native ? null : initShare({ ws: realTransport, storage, mixer, connectDialog });
  if (native) initLink({ udp: realTransport, storage, connectTo, connectDialog, openMonitor });

  // --- QR del musicista ---
  const dialog = document.getElementById('mon-qr-dialog');
  const box = dialog.querySelector('.share-qr');
  const statusEl = dialog.querySelector('.pc-status');
  dialog.querySelector('.mon-qr-close').addEventListener('click', () => dialog.close());

  /** Mostra il QR che porta un musicista sul mix del bus dato (canali: quelli scelti nel monitor). */
  async function showMonitorQr({ bus, name, channels }) {
    dialog.querySelector('h2').textContent = t('Mix di {0} per il musicista', name);
    box.hidden = true;
    box.innerHTML = '';
    statusEl.textContent = '';
    dialog.showModal();
    const mon = { bus, ch: channels };
    let text = null;
    if (isOffline() || mixer.status !== 'online' || !mixer.ip) {
      statusEl.textContent = t('Collega prima questo dispositivo al mixer: il musicista userà lo stesso.');
    } else if (native) {
      // telefono del fonico: se a sua volta passa da un computer, il musicista passa dallo stesso
      const key = realTransport.keys.get(mixer.ip);
      text = key ? linkText([mixer.ip], key, mon) : mixerLinkText(mixer.ip, mon);
    } else if (realTransport.canShare) {
      statusEl.textContent = t('Condivisione in avvio…');
      const st = await share.ensureOn();
      if (st.on && st.ips?.length) text = linkText(st.ips, st.key, mon);
      statusEl.textContent = text ? '' : st.error === 'busy'
        ? t('La porta UDP 10024 di questo computer è già usata da un altro programma: chiudilo e riprova.')
        : t('Condivisione non riuscita. Riprova.');
    } else {
      text = mixerLinkText(mixer.ip, mon);
    }
    if (!text || !dialog.open) return;
    box.innerHTML = await qrSvg(text); // disegnato qui da indirizzi, codice e numeri già controllati
    box.firstElementChild.setAttribute('aria-label', t('Codice QR per il musicista'));
    box.hidden = false;
  }
  return { showMonitorQr };
}
