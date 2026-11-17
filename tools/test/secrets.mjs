// Nessuna chiave segreta né dato personale nei file del progetto (quelli che finirebbero su GitHub).
// Uso: cd tools/test && npm test

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(f => f && !f.includes('node_modules') && !/\.(png|jpe?g|gif|ico|icns|woff2?|ttf|apk|ipa|dmg|zip|jar)$/i.test(f));

const RULES = [
  ['chiave AWS', /AKIA[0-9A-Z]{16}/],
  ['chiave Google', /AIza[0-9A-Za-z_-]{35}/],
  ['chiave OpenAI/Anthropic', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/],
  ['token GitHub', /\b(ghp|gho|ghs)_[A-Za-z0-9]{30,}|github_pat_/],
  ['chiave Resend', /\bre_[A-Za-z0-9]{20,}/],
  ['chiave Stripe', /\b[sr]k_live_[A-Za-z0-9]{10,}/],
  ['chiave privata PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['chiave privata JWK', /"d"\s*:\s*"[A-Za-z0-9_-]{30,}"/],
  ['segreto Supabase (service_role)', /service_role/],
  ['segreto scritto nel codice', /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9+/_-]{16,}['"]/i],
];
// dati personali da non pubblicare: in un file solo locale (escluso da git), uno per riga
const LOCAL = path.join(ROOT, 'tools/test/personal.local.txt');
const PERSONAL = fs.existsSync(LOCAL)
  ? fs.readFileSync(LOCAL, 'utf8').split('\n').map(s => s.trim()).filter(Boolean).map(s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  : [];

let found = 0;
for (const f of files) {
  if (f === 'tools/test/secrets.mjs' || f === 'tools/test/personal.local.txt') continue;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  for (const [name, re] of RULES) if (re.test(text)) { found++; console.log(`FAIL ${f}: ${name}`); }
  for (const re of PERSONAL) if (re.test(text)) { found++; console.log(`FAIL ${f}: dato personale (${re.source})`); }
}
if (found) { console.log(`\n${found} problemi: niente segreti né dati personali nel repository`); process.exit(1); }
console.log(`tutte le prove dei segreti passate (${files.length} file controllati)`);
