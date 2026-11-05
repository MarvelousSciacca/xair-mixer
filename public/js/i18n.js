// Lingue dell'interfaccia. I testi del codice sono in italiano e fanno da chiave: per le altre lingue
// un dizionario (js/lang/xx.js) li traduce. Un osservatore traduce ogni testo e ogni etichetta
// (aria-label, title, placeholder) appena compare nella pagina, così pannelli e finestre creati
// dal codice non devono chiamare t() uno per uno. Le frasi con dentro un valore usano t('… {0} …', valore).
// I nomi scritti dall'utente (canali, scene, snapshot…) stanno in elementi translate="no".

import EN from './lang/en.js';
import ES from './lang/es.js';
import FR from './lang/fr.js';
import DE from './lang/de.js';

const KEY = 'xair.lang';
export const LANGS = [['it', 'Italiano'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch']];
const DICTS = { en: EN, es: ES, fr: FR, de: DE };
// spazi e a capo non contano nel confronto (i testi nell'HTML sono spezzati su più righe)
const norm = s => s.replace(/\s+/g, ' ').trim();
const LOCALES = { it: 'it-IT', en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };

const saved = () => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};
/** Lingua scelta, altrimenti quella del dispositivo se c'è, altrimenti inglese. */
function detect() {
  const s = saved();
  if (s && LANGS.some(([id]) => id === s)) return s;
  const prefs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const p of prefs) {
    const id = String(p ?? '').slice(0, 2).toLowerCase();
    if (LANGS.some(([l]) => l === id)) return id;
  }
  return 'en';
}

export const lang = detect();
export const locale = LOCALES[lang];
const dict = DICTS[lang] ? new Map(Object.entries(DICTS[lang]).map(([k, v]) => [norm(k), v])) : null;

/** Testi scritti dall'utente (nomi di canali, DCA, snapshot…): non si traducono mai. */
const userText = new Set();
export function protectText(text) {
  const n = text && norm(String(text));
  if (!n || userText.has(n)) return;
  userText.add(n);
  cache.clear();
}

/** Traduce un testo italiano; {0}, {1}… vengono sostituiti dagli argomenti. */
export function t(text, ...args) {
  let out = dict?.get(norm(text)) ?? text;
  if (args.length) out = out.replace(/\{#?(\d)\}/g, (m, i) => String(args[Number(i)] ?? ''));
  return out;
}

/** Cambia lingua: si ricarica l'interfaccia (onBefore: per salvare quello che serve). */
export function setLang(id, onBefore) {
  try { localStorage.setItem(KEY, id); } catch { /* non disponibile */ }
  onBefore?.();
  location.reload();
}

// --- traduzione automatica della pagina --------------------------------------------------------

const ATTRS = ['aria-label', 'title', 'placeholder', 'aria-valuetext', 'aria-description'];
const HAS_WORD = /[A-Za-zÀ-ÿ]{2}/;
// frasi con un valore dentro, riconosciute anche quando il codice non usa t(): "Mute Kick (Ch 1)"…
const patterns = [];
if (dict) {
  for (const [k, v] of dict) {
    if (!/\{#?0\}/.test(k)) continue;
    // {0}: qualsiasi testo; {#0}: solo un numero
    const esc = k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(#?)(\d)\}/g, (m, num) => (num ? '([\\d.,:-]+)' : '(.+?)'));
    patterns.push([new RegExp(`^${esc}$`, 's'), v, k.replace(/\{#?\d\}/g, '').length]);
  }
  patterns.sort((a, b) => b[2] - a[2]); // prima le frasi più lunghe: "Mute group {0}" prima di "Mute {0}"
}
const cache = new Map();

function translateString(s) {
  if (!s || !HAS_WORD.test(s)) return null;
  if (cache.has(s)) return cache.get(s);
  const out = lookup(s);
  if (cache.size > 5000) cache.clear();
  cache.set(s, out);
  return out;
}
function lookup(s) {
  const key = norm(s);
  if (userText.has(key)) return null;
  const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
  const hit = dict.get(key);
  if (hit !== undefined) return hit === key ? null : lead + hit + tail;
  if (key.length > 400) return null;
  for (const [re, v] of patterns) {
    const m = key.match(re);
    if (m) return lead + v.replace(/\{#?(\d)\}/g, (x, i) => translateValue(m[Number(i) + 1])) + tail;
  }
  return null;
}
// i valori dentro una frase possono essere a loro volta testi da tradurre ("attivo", "Rosso"…),
// ma non i nomi dati dall'utente
const translateValue = v => translateString(v) ?? v;

// testi appena tradotti: non si ritraducono (una traduzione potrebbe somigliare a un'altra chiave)
const done = new WeakMap();
const mark = (node, key, value) => {
  let m = done.get(node);
  if (!m) done.set(node, (m = {}));
  m[key] = value;
};
const fresh = (node, key, value) => done.get(node)?.[key] === value;

const skip = node => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !el || !!el.closest('[translate="no"], script, style, code');
};

function translateNode(node) {
  if (node.nodeType === 3) {
    if (fresh(node, '#', node.nodeValue) || skip(node)) return;
    const out = translateString(node.nodeValue);
    if (out !== null && out !== node.nodeValue) {
      node.nodeValue = out;
      mark(node, '#', out);
    }
    return;
  }
  if (node.nodeType !== 1 || skip(node)) return;
  for (const a of ATTRS) {
    const v = node.getAttribute(a);
    if (v && !fresh(node, a, v)) {
      const out = translateString(v);
      if (out !== null && out !== v) {
        mark(node, a, out);
        node.setAttribute(a, out);
      }
    }
  }
  if (node.tagName === 'INPUT' && (node.type === 'button' || node.type === 'submit') && node.value) {
    const out = translateString(node.value);
    if (out !== null) node.value = out;
  }
  for (const child of node.childNodes) translateNode(child);
}

/** Avvia la traduzione della pagina (nessun effetto in italiano). */
export function startTranslation(root = document.documentElement) {
  document.documentElement.lang = lang;
  if (!dict) return;
  document.title = t(document.title);
  translateNode(root);
  new window.MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(translateNode);
      else if (r.type === 'characterData') translateNode(r.target);
      else if (r.type === 'attributes') {
        const v = r.target.getAttribute(r.attributeName);
        if (!v || fresh(r.target, r.attributeName, v) || skip(r.target)) continue;
        const out = translateString(v);
        if (out !== null && out !== v) {
          mark(r.target, r.attributeName, out);
          r.target.setAttribute(r.attributeName, out);
        }
      }
    }
  }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// Raccolta dei testi mostrati (per completare i dizionari): ?i18n-collect=1 nell'indirizzo.
export function collectStrings() {
  const seen = new Set();
  const walk = node => {
    if (node.nodeType === 3) {
      const s = node.nodeValue.trim();
      if (HAS_WORD.test(s) && !skip(node)) seen.add(s);
      return;
    }
    if (node.nodeType !== 1 || skip(node)) return;
    for (const a of ATTRS) { const v = node.getAttribute(a)?.trim(); if (v && HAS_WORD.test(v)) seen.add(v); }
    node.childNodes.forEach(walk);
  };
  walk(document.documentElement);
  return [...seen];
}

/** Traduce un testo già composto (per la guida vocale, che non passa dalla pagina). */
export const translate = s => (dict && s ? translateString(s) ?? s : s);
