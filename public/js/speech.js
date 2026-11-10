// Guida vocale: l'app legge da sola, nella lingua scelta, il comando che tocchi e il valore che
// regoli (fader, pan, manopole), più gli avvisi (feedback, connessione, blocco). Pensata per chi
// vede poco e non usa uno screen reader. Se VoiceOver o TalkBack sono accesi tace: leggono già loro.
//
// Voce: nelle app il sintetizzatore del sistema tramite il plugin nativo (la WebView di Android
// non ha la sintesi vocale); nel browser e nell'app per computer la Web Speech API.
import { lang, translate } from './i18n.js';

const KEY = 'xair.voiceGuide';
const VOICES = { it: 'it-IT', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };
export const VOICE_GUIDE = [['off', 'Spenta'], ['on', 'Attiva']];

let plugin = null;
let screenReaderOn = false;
let enabled = false;
try { enabled = localStorage.getItem(KEY) === 'on'; } catch { /* non disponibile */ }

export const voiceGuideSetting = () => (enabled ? 'on' : 'off');
export const voiceGuideAvailable = () => !!plugin || typeof speechSynthesis !== 'undefined';
const active = () => enabled && !screenReaderOn;

export function setVoiceGuide(v) {
  enabled = v === 'on';
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* non disponibile */ }
  if (enabled) speak(screenReaderOn ? 'Guida vocale in pausa: lo screen reader è acceso' : 'Guida vocale attiva', { urgent: true, force: true });
  else stop();
}

function stop() {
  if (plugin) plugin.speak({ text: '', lang: VOICES[lang], flush: true }).catch(() => {});
  else if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

let lastSpokenAt = 0;
let webVoice = null;
const pickWebVoice = () => {
  const all = speechSynthesis.getVoices();
  webVoice = all.find(v => v.lang === VOICES[lang]) ?? all.find(v => v.lang?.startsWith(lang)) ?? null;
};

/**
 * Dice un testo (italiano, viene tradotto). urgent: interrompe quello che sta dicendo.
 * Se non si interrompe e arrivano molti testi (un fader trascinato), resta solo l'ultimo.
 */
export function speak(text, { urgent = true, force = false } = {}) {
  if (!text || !(force ? enabled : active())) return;
  const say = translate(String(text));
  lastSpokenAt = Date.now();
  if (plugin) {
    plugin.speak({ text: say, lang: VOICES[lang], flush: urgent }).catch(() => {});
    return;
  }
  if (typeof speechSynthesis === 'undefined') return;
  if (urgent || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(say);
  u.lang = VOICES[lang];
  if (webVoice) u.voice = webVoice;
  u.rate = 1.1;
  speechSynthesis.speak(u);
}

// valori che cambiano di continuo (fader trascinato): al massimo una lettura ogni tanto, e
// sempre quella finale
let valueTimer = 0;
let lastValueAt = 0;
export function speakValue(text, { final = false } = {}) {
  if (!active()) return;
  clearTimeout(valueTimer);
  const now = Date.now();
  if (final || now - lastValueAt > 700) {
    lastValueAt = now;
    speak(text);
  } else {
    valueTimer = setTimeout(() => { lastValueAt = Date.now(); speak(text); }, 700 - (now - lastValueAt));
  }
}

/** Nome leggibile di un comando: quello per gli screen reader, altrimenti il testo visibile. */
function nameOf(el) {
  const label = el.getAttribute('aria-label') ?? el.getAttribute('title');
  if (label) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
  return el.textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Avvia la guida: native è il plugin delle app (o null). Legge i tasti toccati con il loro stato
 * (attivo / spento) e i cursori regolati con la tastiera.
 */
export function startVoiceGuide(native = null) {
  if (native?.speak) plugin = native;
  if (!plugin && typeof speechSynthesis !== 'undefined') {
    pickWebVoice();
    speechSynthesis.addEventListener?.('voiceschanged', pickWebVoice);
  }
  // Nelle app i cursori nativi trasparenti sopra fader e manopole servono solo a VoiceOver e TalkBack.
  // Senza screen reader li si rende "trasparenti" anche al dito: su iPhone il cursore nativo si prendeva
  // il tocco e il doppio tocco sul fader non arrivava.
  const root = document.documentElement;
  if (plugin?.screenReader) root.classList.add('sr-off');
  const check = () => {
    if (!plugin?.screenReader) return;
    plugin.screenReader().then(r => {
      screenReaderOn = !!r?.on;
      root.classList.toggle('sr-off', !screenReaderOn);
    }).catch(() => {});
  };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 5000); // lo screen reader si può accendere anche con l'app aperta

  document.addEventListener('click', e => {
    if (!active()) return;
    const el = e.target.closest?.('button, [role="tab"], [role="button"], a, summary, label');
    if (!el || el.closest('[aria-hidden="true"]')) return;
    // lo stato si legge dopo il click: prima lo deve cambiare il tasto stesso. Se il tasto ha già
    // fatto dire qualcosa ("Comandi bloccati…"), il suo nome non lo copre.
    const clickedAt = Date.now();
    setTimeout(() => {
      if (lastSpokenAt >= clickedAt) return;
      let text = nameOf(el);
      const pressed = el.getAttribute('aria-pressed');
      if (pressed === 'true') text += `, ${translate('attivo')}`;
      else if (pressed === 'false' && el.closest('.segmented') == null) text += `, ${translate('spento')}`;
      if (text) speak(text);
    }, 80);
  }, true);
  document.addEventListener('change', e => {
    const el = e.target;
    if (!active() || el.tagName !== 'SELECT') return;
    speak(`${nameOf(el)}: ${el.selectedOptions[0]?.textContent ?? ''}`); // già tradotti nella pagina
  }, true);
}
