// Tema applicato prima del primo disegno, per non far lampeggiare la pagina (vedi js/theme.js).
// Script classico e sincrono, in un file a parte: la Content Security Policy non ammette script inline.
try {
  const t = localStorage.getItem('xair.theme') || 'dark';
  document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
} catch {
  document.documentElement.dataset.theme = 'dark';
}
// Dimensione dell'interfaccia e contrasto alto (vedi js/a11y.js), anch'essi prima del primo disegno.
try {
  const z = Number(localStorage.getItem('xair.uiSize')) || 1;
  if (z !== 1) document.documentElement.style.zoom = String(z);
  const c = localStorage.getItem('xair.contrast') || 'auto';
  document.documentElement.dataset.contrast = c === 'more' || (c === 'auto' && matchMedia('(prefers-contrast: more)').matches) ? 'more' : 'normal';
} catch { /* non disponibile */ }
