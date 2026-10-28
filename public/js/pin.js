// PIN di questo dispositivo per la modalità monitor: chi ha il telefono può muovere solo il proprio
// mix e, a schermata bloccata, non può uscirne senza PIN. Protegge dagli errori, non da chi conosce
// l'OSC: qualsiasi dispositivo sulla rete del mixer può comunque comandarlo.
// Il PIN non è salvato in chiaro: solo un hash con sale.

import { ask, notify } from './dialogs.js';

const KEY = 'xair.pin';
const MAX_TRIES = 5;
const WAIT_MS = 30_000;
export const PIN_PATTERN = /^\d{4,8}$/;

async function digest(salt, pin) {
  const text = `${salt}:${pin}`;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let x = 0x811c9dc5; // FNV-1a, solo dove manca crypto.subtle (pagina non sicura)
  for (const c of text) x = Math.imul(x ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `fnv${x.toString(16)}`;
}

function randomSalt() {
  const a = new Uint8Array(8);
  globalThis.crypto?.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; });
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function createPin(storage) {
  let tries = 0;
  let blockedUntil = 0;
  const saved = () => {
    try {
      const v = JSON.parse(storage.get(KEY) ?? 'null');
      return v?.salt && v?.hash ? v : null;
    } catch {
      return null;
    }
  };

  const pin = {
    has: () => !!saved(),

    async set(value) {
      if (!PIN_PATTERN.test(value)) throw new Error('Il PIN deve avere da 4 a 8 cifre');
      const salt = randomSalt();
      storage.set(KEY, JSON.stringify({ salt, hash: await digest(salt, value) }));
    },

    clear() {
      storage.set(KEY, '');
    },

    /** true se il PIN è giusto; dopo 5 errori bisogna aspettare 30 secondi. */
    async check(value) {
      const s = saved();
      if (!s) return true;
      if (Date.now() < blockedUntil) return false;
      const ok = (await digest(s.salt, String(value ?? ''))) === s.hash;
      tries = ok ? 0 : tries + 1;
      if (tries >= MAX_TRIES) {
        tries = 0;
        blockedUntil = Date.now() + WAIT_MS;
      }
      return ok;
    },

    /** Chiede il PIN; true se giusto (o se non c'è un PIN). */
    async request(title = 'PIN') {
      if (!pin.has()) return true;
      if (Date.now() < blockedUntil) {
        notify(`Troppi tentativi: riprova tra ${Math.ceil((blockedUntil - Date.now()) / 1000)} secondi`, { error: true });
        return false;
      }
      const value = await ask({ title, message: 'Inserisci il PIN di questo dispositivo.', input: '', secret: true, maxLength: 8, confirmText: 'Sblocca' });
      if (value === null) return false;
      if (await pin.check(value)) return true;
      notify(Date.now() < blockedUntil ? 'PIN sbagliato. Troppi tentativi: aspetta 30 secondi.' : 'PIN sbagliato', { error: true });
      return false;
    },
  };
  return pin;
}
