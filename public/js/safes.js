// Canali protetti ("safe"): caricando una scena o uno snapshot i loro parametri non cambiano.
// Proteggere un bus o una mandata FX protegge anche le mandate di tutti i canali verso di esso,
// così il mix di un monitor resta com'è. La scelta vale per questo dispositivo.

const KEY = 'xair.safes';
const pad2 = n => String(n).padStart(2, '0');

const storage = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
  },
  set(ids) {
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* non disponibile */ }
  },
};

/** Le strip che si possono proteggere (i DCA no: sono solo un comando di gruppo). */
export const protectable = strips => strips.filter(s => s.group !== 'dca');

/** Funzione address -> true se l'indirizzo appartiene a una strip protetta. */
function matcher(strips, ids) {
  const prefixes = [];
  const sends = []; // numero di mandata (01-10) da proteggere su tutti i canali
  for (const s of strips.filter(x => ids.includes(x.id))) {
    prefixes.push(`${s.base}/`);
    if (s.headamp) prefixes.push(`/headamp/${pad2(s.headamp)}/`);
    const bus = s.id.match(/^bus(\d)$/);
    const fx = s.id.match(/^fxsend(\d)$/);
    if (bus) sends.push(pad2(Number(bus[1])));
    if (fx) sends.push(pad2(6 + Number(fx[1])));
  }
  const sendRe = sends.length ? new RegExp(`/mix/(${sends.join('|')})/`) : null;
  return address => prefixes.some(p => address.startsWith(p)) || !!sendRe?.test(address);
}

export function createSafes(strips) {
  let ids = storage.get().filter(id => strips.some(s => s.id === id));
  const listeners = new Set();
  return {
    get ids() { return [...ids]; },
    has: id => ids.includes(id),
    toggle(id) {
      ids = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
      storage.set(ids);
      listeners.forEach(cb => cb());
    },
    onChange(cb) {
      listeners.add(cb);
    },
    /** Indirizzi protetti tra quelli dati. */
    filter(addresses) {
      if (!ids.length) return [];
      const m = matcher(strips, ids);
      return addresses.filter(m);
    },
  };
}
