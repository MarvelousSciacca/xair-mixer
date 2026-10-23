// Tema applicato prima del primo disegno, per non far lampeggiare la pagina (vedi js/theme.js).
// Script classico e sincrono, in un file a parte: la Content Security Policy non ammette script inline.
try {
  const t = localStorage.getItem('xair.theme') || 'light';
  document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
} catch {
  document.documentElement.dataset.theme = 'light';
}
