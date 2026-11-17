// Server delle licenze di riferimento (account con email e codice, fino a 3 dispositivi).
// È la specifica viva dell'API usata da public/js/license.js: le prove lo usano in memoria; il server vero
// (Supabase o altro) deve rispondere allo stesso modo. Firma i gettoni con ECDSA P-256 (chiave privata solo qui).
//
//   node server/license-server.js --new-key     → stampa una coppia di chiavi nuova (JWK)

import { webcrypto as crypto } from 'node:crypto';

export const MAX_DEVICES = 3;
const CODE_TTL = 10 * 60_000;
const MAX_CODE_TRIES = 5;

const b64url = buf => Buffer.from(buf).toString('base64url');

export async function newKeyPair() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    privateJwk: await crypto.subtle.exportKey('jwk', k.privateKey),
    publicJwk: await crypto.subtle.exportKey('jwk', k.publicKey),
  };
}

/**
 * privateJwk: chiave di firma. sendCode(email, code): spedisce l'email (nelle prove la raccoglie).
 * Gli acquisti arrivano da grant(email) (in produzione: dal webhook del servizio di pagamento).
 */
export async function createLicenseServer({ privateJwk, sendCode, now = () => Date.now() }) {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const licensed = new Set();          // email con licenza
  const codes = new Map();             // email → { code, until, tries }
  const sessions = new Map();          // sessione → email
  const devices = new Map();           // email → Map(id → { id, name, platform, since })
  const revoked = new Set();           // email|dev tolti

  const list = email => [...(devices.get(email)?.values() ?? [])];
  const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });
  const ok = body => ({ status: 200, body });
  const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

  async function sign(payload) {
    const data = Buffer.from(JSON.stringify(payload));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
    return `${b64url(data)}.${b64url(sig)}`;
  }
  const sessionEmail = s => (typeof s === 'string' && sessions.get(s)) || null;

  const routes = {
    async '/v1/code'({ email }) {
      email = String(email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'bad-email');
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
      codes.set(email, { code, until: now() + CODE_TTL, tries: 0 });
      await sendCode(email, code);
      return ok({});
    },
    async '/v1/login'({ email, code }) {
      email = String(email ?? '').trim().toLowerCase();
      const c = codes.get(email);
      if (!c || now() > c.until || c.tries >= MAX_CODE_TRIES) return fail(400, 'bad-code');
      if (String(code) !== c.code) { c.tries++; return fail(400, 'bad-code'); }
      codes.delete(email);
      const session = random(24);
      sessions.set(session, email);
      return ok({ session, licensed: licensed.has(email) });
    },
    async '/v1/activate'({ session, device }) {
      const email = sessionEmail(session);
      if (!email) return fail(401, 'session');
      if (!licensed.has(email)) return fail(403, 'no-license');
      const id = String(device?.id ?? '');
      if (!/^[0-9a-f-]{16,64}$/.test(id)) return fail(400, 'server');
      const mine = devices.get(email) ?? new Map();
      if (!mine.has(id) && mine.size >= MAX_DEVICES) return fail(409, 'limit', { devices: list(email) });
      mine.set(id, { id, name: String(device.name ?? '').slice(0, 40), platform: String(device.platform ?? '').slice(0, 10), since: mine.get(id)?.since ?? now() });
      devices.set(email, mine);
      revoked.delete(`${email}|${id}`);
      return ok({ token: await sign({ v: 1, email, dev: id, iat: now() }), devices: list(email) });
    },
    async '/v1/devices'({ session }) {
      const email = sessionEmail(session);
      return email ? ok({ devices: list(email) }) : fail(401, 'session');
    },
    async '/v1/remove'({ session, deviceId }) {
      const email = sessionEmail(session);
      if (!email) return fail(401, 'session');
      if (devices.get(email)?.delete(String(deviceId))) revoked.add(`${email}|${deviceId}`);
      return ok({ devices: list(email) });
    },
    async '/v1/check'({ token }) {
      try {
        const payload = JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url'));
        return ok({ valid: licensed.has(payload.email) && devices.get(payload.email)?.has(payload.dev) === true });
      } catch {
        return fail(400, 'server');
      }
    },
  };

  /** fetch finto per le prove: stessa interfaccia di window.fetch. */
  async function fetchImpl(url, { body }) {
    const route = routes[new URL(url).pathname];
    const res = route ? await route(JSON.parse(body)) : fail(404, 'server');
    return { ok: res.status === 200, status: res.status, json: async () => res.body };
  }

  return { fetchImpl, grant: email => licensed.add(email.toLowerCase()), revokeLicense: email => licensed.delete(email.toLowerCase()), devices: list };
}

if (process.argv[1]?.endsWith('license-server.js') && process.argv.includes('--new-key')) {
  const { privateJwk, publicJwk } = await newKeyPair();
  console.log('PRIVATA (solo sul server, mai nel repository):\n' + JSON.stringify(privateJwk));
  console.log('\nPUBBLICA (in public/js/license-config.js):\n' + JSON.stringify(publicJwk));
}

// Modalità di prova: `node server/license-server.js --dev [porta]` → server HTTP locale che dà la licenza a
// ogni email e stampa i codici qui invece di spedirli. Scrive la chiave pubblica in license-dev.json.
if (process.argv[1]?.endsWith('license-server.js') && process.argv.includes('--dev')) {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const port = Number(process.argv[process.argv.indexOf('--dev') + 1]) || 8787;
  const { privateJwk, publicJwk } = await newKeyPair();
  let lastCode = '';
  const server = await createLicenseServer({ privateJwk, sendCode: (e, c) => { lastCode = c; console.log(`codice per ${e}: ${c}`); } });
  const origGrant = server.grant;
  fs.writeFileSync(new URL('../tools/qa/out/license-dev.json', import.meta.url), JSON.stringify({ apiBase: `http://localhost:${port}`, publicKeyJwk: publicJwk }));
  http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.end();
    if (req.url === '/dev/code') return res.end(JSON.stringify({ code: lastCode })); // solo per le prove a schermo
    let body = '';
    for await (const chunk of req) body += chunk;
    try { const { email } = JSON.parse(body || '{}'); if (email) origGrant(email); } catch { /* niente */ }
    const r = await server.fetchImpl(`http://x${req.url}`, { body: body || '{}' });
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(await r.json()));
  }).listen(port, () => console.log(`server licenze di prova su http://localhost:${port}`));
}
