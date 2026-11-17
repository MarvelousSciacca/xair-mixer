// Licenza di AirDesk: prova di 14 giorni, poi account con email e codice, fino a 3 dispositivi.
//
// Funziona offline. Internet serve solo per accedere, attivare un dispositivo e liberarne uno: il server
// rilascia allora un "gettone" firmato (ECDSA P-256) che dice "questo dispositivo di questa email è attivo".
// L'app lo verifica da sola con la chiave pubblica (license-config.js), senza rete, ogni volta che parte.
// Quando c'è rete ricontrolla in silenzio se il dispositivo è stato tolto da un altro; se la rete non c'è
// non succede niente (al concerto sul Wi-Fi del mixer tutto continua a funzionare).
//
// La prova parte al primo collegamento a un mixer vero e si conta sul dispositivo. L'orologio non può
// tornare indietro: si usa sempre il momento più avanti mai visto (spostare la data non allunga la prova).
//
// API del server (JSON, POST): /v1/code {email} · /v1/login {email, code} → {session}
//   /v1/activate {session, device} → {token, devices} | 403 no-license | 409 limit {devices}
//   /v1/devices {session} → {devices} · /v1/remove {session, deviceId} → {devices} · /v1/check {token} → {valid}

export const TRIAL_DAYS = 14;
export const MAX_DEVICES = 3;
const DAY = 86_400_000;
const CHECK_EVERY = 6 * 3_600_000; // controllo silenzioso quando c'è rete

const KEYS = {
  device: 'airdesk.deviceId',
  trial: 'airdesk.trialStart',
  clock: 'airdesk.clock',
  token: 'airdesk.license',
  session: 'airdesk.session',
  email: 'airdesk.email',
  lastCheck: 'airdesk.licenseCheck',
};

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));

/** Nome leggibile del dispositivo, per l'elenco dei 3 posti. */
export function deviceName(platform = 'web', ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  if (platform === 'ios') return /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) ? 'iPad' : 'iPhone';
  if (platform === 'android') return /Mobile/.test(ua) ? 'Telefono Android' : 'Tablet Android';
  const os = /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'PC Windows' : /Linux/.test(ua) ? 'PC Linux' : 'Computer';
  return /Electron/.test(ua) ? os : `${os} (browser)`;
}

/** Errore del server o della rete, con un codice da tradurre in un messaggio per l'utente. */
export class LicenseError extends Error {
  constructor(code, data = {}) {
    super(code);
    this.code = code; // offline | bad-email | bad-code | no-license | limit | session | server
    this.data = data;
  }
}

/**
 * storage: { get, set } (localStorage). config: { enabled, apiBase, publicKeyJwk }.
 * platform: 'ios' | 'android' | 'web'. fetchImpl / now / subtle: sostituibili nelle prove.
 */
export function createLicense({ storage, config, platform = 'web', lang = 'it', fetchImpl = globalThis.fetch?.bind(globalThis), now = () => Date.now(), subtle = globalThis.crypto?.subtle }) {
  const listeners = new Set();
  let verified = null; // contenuto del gettone valido, o null
  let keyPromise = null;

  const del = k => storage.set(k, '');
  const read = k => storage.get(k) || null;

  // momento attuale "che non torna indietro"
  function clock() {
    const seen = Number(read(KEYS.clock)) || 0;
    const t = Math.max(now(), seen);
    if (t > seen) storage.set(KEYS.clock, String(t));
    return t;
  }

  function deviceId() {
    let id = read(KEYS.device);
    if (!id || !/^[0-9a-f-]{16,64}$/.test(id)) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      storage.set(KEYS.device, id);
    }
    return id;
  }

  // --- verifica del gettone, senza rete --------------------------------------------------
  function publicKey() {
    keyPromise ??= subtle.importKey('jwk', config.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return keyPromise;
  }

  /** Il contenuto del gettone se la firma è giusta ed è di questo dispositivo, altrimenti null. */
  async function verifyToken(token) {
    if (!token || !subtle || !config.publicKeyJwk) return null;
    const [p, s] = String(token).split('.');
    if (!p || !s) return null;
    try {
      const data = fromB64url(p);
      const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await publicKey(), fromB64url(s), data);
      if (!ok) return null;
      const payload = JSON.parse(new TextDecoder().decode(data));
      return payload?.v === 1 && payload.dev === deviceId() && typeof payload.email === 'string' ? payload : null;
    } catch {
      return null;
    }
  }

  // --- stato -----------------------------------------------------------------------------
  function trialLeft() {
    const start = Number(read(KEYS.trial)) || 0;
    if (!start) return TRIAL_DAYS;
    return Math.max(0, TRIAL_DAYS - Math.floor((clock() - start) / DAY));
  }

  /**
   * { kind: 'off' | 'licensed' | 'trial' | 'trial-unstarted' | 'expired', email, daysLeft }
   * 'off': licenze non ancora attive in questa versione (tutto libero).
   */
  function state() {
    if (!config.enabled) return { kind: 'off' };
    if (verified) return { kind: 'licensed', email: verified.email };
    const started = !!Number(read(KEYS.trial));
    const daysLeft = trialLeft();
    if (!started) return { kind: 'trial-unstarted', daysLeft, email: read(KEYS.email) };
    return daysLeft > 0 ? { kind: 'trial', daysLeft, email: read(KEYS.email) } : { kind: 'expired', email: read(KEYS.email) };
  }
  const emit = () => listeners.forEach(cb => cb(state()));

  /** Si può comandare un mixer vero da questo dispositivo? */
  const canControl = () => state().kind !== 'expired';

  /** Primo collegamento a un mixer vero: parte la prova (una volta sola). */
  function startTrial() {
    if (!config.enabled || verified || Number(read(KEYS.trial))) return;
    storage.set(KEYS.trial, String(clock()));
    emit();
  }

  // --- server ----------------------------------------------------------------------------
  async function call(path, body) {
    if (!config.apiBase || !fetchImpl) throw new LicenseError('offline');
    let res;
    try {
      res = await fetchImpl(`${config.apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new LicenseError('offline');
    }
    let data = {};
    try { data = await res.json(); } catch { /* risposta vuota */ }
    if (!res.ok) throw new LicenseError(data.error || 'server', data);
    return data;
  }

  const session = () => read(KEYS.session);
  const needSession = () => {
    const s = session();
    if (!s) throw new LicenseError('session');
    return s;
  };

  async function requestCode(email) {
    email = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LicenseError('bad-email');
    await call('/v1/code', { email, lang });
    storage.set(KEYS.email, email);
  }

  async function login(code) {
    const email = read(KEYS.email);
    const { session: s } = await call('/v1/login', { email, code: String(code).trim() });
    storage.set(KEYS.session, s);
    emit();
  }

  /** Attiva questo dispositivo: risolve con l'elenco dei dispositivi; LicenseError 'limit' se i posti sono pieni. */
  async function activate() {
    const res = await call('/v1/activate', {
      session: needSession(),
      device: { id: deviceId(), name: deviceName(platform), platform },
    });
    const payload = await verifyToken(res.token);
    if (!payload) throw new LicenseError('server');
    storage.set(KEYS.token, res.token);
    storage.set(KEYS.lastCheck, String(clock()));
    verified = payload;
    emit();
    return res.devices ?? [];
  }

  const devices = async () => (await call('/v1/devices', { session: needSession() })).devices ?? [];
  const removeDevice = async id => {
    const res = await call('/v1/remove', { session: needSession(), deviceId: id });
    if (id === deviceId()) forget();
    return res.devices ?? [];
  };

  function forget() {
    del(KEYS.token);
    verified = null;
    emit();
  }

  /** Esci da questo dispositivo: libera il posto (serve la rete) e toglie l'accesso. */
  async function signOut() {
    if (session()) await removeDevice(deviceId());
    del(KEYS.session);
    forget();
  }

  /** Controllo silenzioso: se il dispositivo è stato tolto da un altro, la licenza qui decade. */
  async function check({ force = false } = {}) {
    const token = read(KEYS.token);
    if (!config.enabled || !token) return;
    const last = Number(read(KEYS.lastCheck)) || 0;
    if (!force && clock() - last < CHECK_EVERY) return;
    try {
      const { valid } = await call('/v1/check', { token });
      storage.set(KEYS.lastCheck, String(clock()));
      if (valid === false) forget();
    } catch { /* niente rete: si resta come si è */ }
  }

  /** All'avvio: verifica il gettone salvato (offline) e, se c'è rete, controlla in silenzio. */
  async function init() {
    if (!config.enabled) return state();
    clock();
    verified = await verifyToken(read(KEYS.token));
    emit();
    check();
    return state();
  }

  return {
    init, state, canControl, startTrial, check,
    requestCode, login, activate, devices, removeDevice, signOut,
    deviceId, hasSession: () => !!session(), email: () => read(KEYS.email),
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

export { b64url, fromB64url };
