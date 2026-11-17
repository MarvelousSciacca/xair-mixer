// Server delle licenze di AirDesk (Supabase Edge Function). Stessa API di server/license-server.js,
// che resta il riferimento usato dalle prove: /v1/code /v1/login /v1/activate /v1/devices /v1/remove /v1/check.
//
// Segreti (supabase secrets set …, mai nel repository):
//   LICENSE_PRIVATE_JWK  chiave privata ECDSA P-256 che firma i gettoni (la pubblica è nell'app)
//   RESEND_API_KEY       per spedire il codice di accesso
//   RESEND_FROM          mittente, es. "AirDesk <accesso@tuodominio.it>" (senza dominio: onboarding@resend.dev)
// Forniti da Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const MAX_DEVICES = 3;
const CODE_TTL_MIN = 10;
const MAX_CODE_TRIES = 5;
const MAX_CODES_PER_HOUR = 5;
const SESSION_DAYS = 30;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
const sha256 = async (s: string) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const now = () => new Date();

const privateJwk = JSON.parse(Deno.env.get('LICENSE_PRIVATE_JWK') ?? '{}');
const signKey = crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
const { d: _d, key_ops: _o, ...pub } = privateJwk;
const verifyKey = crypto.subtle.importKey('jwk', { ...pub, key_ops: ['verify'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);

async function sign(payload: unknown) {
  const data = enc.encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signKey, data);
  return `${b64url(data)}.${b64url(sig)}`;
}
async function readToken(token: string) {
  const [p, s] = String(token).split('.');
  if (!p || !s) return null;
  const data = fromB64url(p);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await verifyKey, fromB64url(s), data);
  return ok ? JSON.parse(new TextDecoder().decode(data)) : null;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string, extra = {}) => reply(status, { error, ...extra });

async function sendCode(email: string, code: string, lang: string) {
  const it = lang === 'it';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM') ?? 'AirDesk <onboarding@resend.dev>',
      to: [email],
      subject: it ? `Il tuo codice AirDesk: ${code}` : `Your AirDesk code: ${code}`,
      text: it
        ? `Il tuo codice per accedere ad AirDesk è ${code}.\nVale ${CODE_TTL_MIN} minuti. Se non l'hai chiesto tu, ignora questa email.`
        : `Your code to sign in to AirDesk is ${code}.\nIt's valid for ${CODE_TTL_MIN} minutes. If you didn't ask for it, ignore this email.`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
}

async function sessionEmail(session: unknown) {
  if (typeof session !== 'string' || session.length < 20) return null;
  const { data } = await db.from('sessions').select('email, expires_at').eq('token_hash', await sha256(session)).maybeSingle();
  return data && new Date(data.expires_at) > now() ? data.email as string : null;
}
const deviceList = async (email: string) =>
  ((await db.from('devices').select('id, name, platform, since').eq('email', email).order('since')).data ?? [])
    .map(d => ({ ...d, since: new Date(d.since).getTime() }));

// deno-lint-ignore no-explicit-any
const routes: Record<string, (b: any) => Promise<Response>> = {
  async '/v1/code'({ email, lang }) {
    email = String(email ?? '').trim().toLowerCase();
    if (!validEmail(email)) return fail(400, 'bad-email');
    const { data: prev } = await db.from('login_codes').select('sent_at, sent_count').eq('email', email).maybeSingle();
    const withinHour = prev && now().getTime() - new Date(prev.sent_at).getTime() < 3_600_000;
    if (withinHour && prev.sent_count >= MAX_CODES_PER_HOUR) return fail(429, 'server');
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    await db.from('login_codes').upsert({
      email,
      code_hash: await sha256(`${email}|${code}`),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
      tries: 0,
      sent_at: withinHour ? prev.sent_at : now().toISOString(),
      sent_count: withinHour ? prev.sent_count + 1 : 1,
    });
    await sendCode(email, code, String(lang ?? 'it'));
    return reply(200, {});
  },

  async '/v1/login'({ email, code }) {
    email = String(email ?? '').trim().toLowerCase();
    const { data: c } = await db.from('login_codes').select('*').eq('email', email).maybeSingle();
    if (!c || new Date(c.expires_at) < now() || c.tries >= MAX_CODE_TRIES) return fail(400, 'bad-code');
    if ((await sha256(`${email}|${String(code ?? '').trim()}`)) !== c.code_hash) {
      await db.from('login_codes').update({ tries: c.tries + 1 }).eq('email', email);
      return fail(400, 'bad-code');
    }
    await db.from('login_codes').delete().eq('email', email);
    const session = random(24);
    await db.from('sessions').insert({
      token_hash: await sha256(session),
      email,
      expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
    });
    const { data: lic } = await db.from('licenses').select('email').eq('email', email).is('revoked_at', null).maybeSingle();
    return reply(200, { session, licensed: !!lic });
  },

  async '/v1/activate'({ session, device }) {
    const email = await sessionEmail(session);
    if (!email) return fail(401, 'session');
    const id = String(device?.id ?? '');
    if (!/^[0-9a-f-]{16,64}$/.test(id)) return fail(400, 'server');
    const { data: result, error } = await db.rpc('activate_device', {
      p_email: email, p_id: id, p_name: String(device?.name ?? ''), p_platform: String(device?.platform ?? ''), p_max: MAX_DEVICES,
    });
    if (error) throw error;
    if (result === 'no-license') return fail(403, 'no-license');
    if (result === 'limit') return fail(409, 'limit', { devices: await deviceList(email) });
    return reply(200, { token: await sign({ v: 1, email, dev: id, iat: Date.now() }), devices: await deviceList(email) });
  },

  async '/v1/devices'({ session }) {
    const email = await sessionEmail(session);
    return email ? reply(200, { devices: await deviceList(email) }) : fail(401, 'session');
  },

  async '/v1/remove'({ session, deviceId }) {
    const email = await sessionEmail(session);
    if (!email) return fail(401, 'session');
    await db.from('devices').delete().eq('email', email).eq('id', String(deviceId ?? ''));
    return reply(200, { devices: await deviceList(email) });
  },

  async '/v1/check'({ token }) {
    const payload = await readToken(String(token ?? '')).catch(() => null);
    if (!payload?.email || !payload?.dev) return fail(400, 'server');
    const [{ data: lic }, { data: dev }] = await Promise.all([
      db.from('licenses').select('email').eq('email', payload.email).is('revoked_at', null).maybeSingle(),
      db.from('devices').select('id').eq('email', payload.email).eq('id', payload.dev).maybeSingle(),
    ]);
    return reply(200, { valid: !!lic && !!dev });
  },
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'server');
  // l'indirizzo arriva come /license/v1/code: conta solo la parte finale
  const path = new URL(req.url).pathname.replace(/^.*(\/v1\/[a-z]+)$/, '$1');
  const route = routes[path];
  if (!route) return fail(404, 'server');
  let body = {};
  try { body = await req.json(); } catch { return fail(400, 'server'); }
  try {
    return await route(body);
  } catch (e) {
    console.error(path, e);
    return fail(500, 'server');
  }
});
