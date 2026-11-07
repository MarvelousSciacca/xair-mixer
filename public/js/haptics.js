// Vibrazione sotto il dito, come la rotella della sveglia dell'iPhone: uno scatto leggero a ogni
// passo di fader, pan e manopole, uno più deciso sui punti di riferimento (0 dB, centro del pan,
// metà di una manopola bipolare). Nelle app usa il motore aptico del sistema tramite il plugin
// nativo; nel browser (Chrome su Android) navigator.vibrate. Su computer non c'è.

const KEY = 'xair.haptics';
export const HAPTICS = [['off', 'Spenta'], ['on', 'Attiva']];

let plugin = null;
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* non disponibile */ }

const webVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const hapticsAvailable = () => !!plugin || webVibrate();
export const hapticsSetting = () => (enabled ? 'on' : 'off');
export function setHaptics(v) {
  enabled = v === 'on';
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* non disponibile */ }
  if (enabled) haptic(true);
}

/** Avvia con il plugin delle app (o null nel browser). */
export function startHaptics(native = null) {
  plugin = native ?? null;
}

// trascinando veloce arrivano molti passi in pochi millisecondi: il motore aptico non li
// distinguerebbe e si sentirebbe un ronzio. Al massimo uno scatto ogni 25 ms; quelli forti passano.
const MIN_GAP_MS = 25;
let last = 0;

/** Uno scatto: leggero, o deciso (strong) sui punti di riferimento. */
export function haptic(strong = false) {
  if (!enabled) return;
  const now = performance.now();
  if (!strong && now - last < MIN_GAP_MS) return;
  last = now;
  if (plugin) plugin.haptic({ strong }).catch(() => { /* app installata prima di questa funzione */ });
  else if (webVibrate()) navigator.vibrate(strong ? 18 : 6);
}

/**
 * Da chiamare quando un controllo passa dallo scatto `from` allo scatto `to` mentre lo si
 * trascina. Se in mezzo c'è un punto di riferimento (anche saltato da un movimento veloce) lo
 * scatto è deciso.
 */
export function hapticStep(from, to, detents = []) {
  if (from === to || from == null) return;
  const lo = Math.min(from, to), hi = Math.max(from, to);
  // il punto di riferimento conta quando ci si arriva o lo si attraversa, non quando lo si lascia
  haptic(detents.some(d => (d > lo && d <= hi) || (d === lo && to === lo)));
}
