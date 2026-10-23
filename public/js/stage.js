// Strumenti per il palco: Annulla/Ripeti, blocco dei comandi contro i tocchi per sbaglio e schermo
// sempre acceso mentre si è collegati al mixer.

const UNLOCK_HOLD_MS = 800;

const isTyping = el => el?.closest?.('input, textarea, select, [contenteditable="true"]');

/** Pulsanti Annulla/Ripeti e scorciatoie Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z (o Ctrl+Y). */
export function createHistoryButtons(mixer, { undoBtn, redoBtn }) {
  undoBtn.addEventListener('click', () => mixer.undo());
  redoBtn.addEventListener('click', () => mixer.redo());
  mixer.onHistory(({ canUndo, canRedo }) => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  });
  window.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || isTyping(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) mixer.undo();
    else if ((key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey)) mixer.redo();
    else return;
    e.preventDefault();
  });
}

/**
 * Blocco: un velo trasparente sopra l'app ferma tocchi, rotella e tastiera; i meter continuano a muoversi.
 * Si sblocca tenendo premuto il pulsante in basso (con la tastiera basta premerlo).
 */
export function createLock({ lockBtn, overlay, unlockBtn }) {
  let timer = 0;
  const setLocked = on => {
    overlay.hidden = !on;
    document.body.classList.toggle('locked', on);
    lockBtn.setAttribute('aria-pressed', String(on));
    if (on) unlockBtn.focus({ preventScroll: true });
    else lockBtn.focus({ preventScroll: true });
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
    unlockBtn.classList.remove('holding');
  };
  lockBtn.addEventListener('click', () => setLocked(true));
  unlockBtn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    unlockBtn.setPointerCapture(e.pointerId);
    unlockBtn.classList.add('holding');
    timer = setTimeout(() => {
      cancel();
      setLocked(false);
    }, UNLOCK_HOLD_MS);
  });
  unlockBtn.addEventListener('pointerup', cancel);
  unlockBtn.addEventListener('pointercancel', cancel);
  unlockBtn.addEventListener('click', e => {
    if (e.detail === 0) setLocked(false); // attivato dalla tastiera (Invio o Spazio)
  });
  // il velo non lascia passare menu contestuali e tasti verso i comandi sotto
  overlay.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (overlay.hidden || e.target === unlockBtn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  return { setLocked, get locked() { return !overlay.hidden; } };
}

/**
 * Schermo sempre acceso mentre si è collegati. Nelle app usa il plugin nativo (keepAwake),
 * nel browser e nell'app per computer la Wake Lock API.
 */
export function keepScreenAwake(mixer, nativePlugin = null) {
  let wanted = false;
  let sentinel = null;
  const webLock = async () => {
    if (!navigator.wakeLock || sentinel || !wanted || document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => { sentinel = null; });
      if (!wanted) sentinel.release();
    } catch { /* non permesso (batteria scarica, pagina non visibile...) */ }
  };
  const apply = on => {
    if (on === wanted) return;
    wanted = on;
    if (nativePlugin) {
      nativePlugin.keepAwake({ on }).catch(() => { /* app installata prima di questa funzione */ });
    } else if (on) {
      webLock();
    } else {
      sentinel?.release();
    }
  };
  // il blocco del browser cade quando la pagina va in secondo piano: si richiede al ritorno
  if (!nativePlugin) document.addEventListener('visibilitychange', webLock);
  mixer.onStatus(status => apply(status !== 'disconnected'));
}
