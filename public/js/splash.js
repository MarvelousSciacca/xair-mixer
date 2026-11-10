// Apertura animata: l'animazione è tutta in CSS (ottava.css) e parte da sola; qui si toglie il velo alla
// fine o al primo tocco. Le finestre di avvio aspettano splashDone, altrimenti comparirebbero sopra.

const el = document.getElementById('ol-splash');
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const splashDone = new Promise(resolve => {
  if (!el || reduced) { el?.remove(); resolve(); return; }
  const close = () => { el.remove(); resolve(); };
  el.addEventListener('pointerdown', close);
  el.addEventListener('animationend', e => { if (e.target === el) close(); });
  setTimeout(close, 1800); // se le animazioni non partono non deve restare davanti all'app
});
