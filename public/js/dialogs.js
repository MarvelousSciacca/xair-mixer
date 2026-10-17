// Finestre di conferma e di inserimento testo (al posto di confirm/prompt, che non funzionano
// in tutte le versioni app).

/**
 * ask({ title, message, input, confirmText, danger, requireText }) -> Promise<string|true|null>
 * input: valore iniziale di un campo di testo (se presente restituisce il testo).
 * requireText: parola da digitare per abilitare la conferma (azioni pericolose).
 */
export function ask({ title, message = '', input = null, confirmText = 'OK', danger = false, requireText = null, maxLength = 32 }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ask-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <h2></h2>
        <p class="ask-message"></p>
        <input class="ask-input" autocomplete="off" hidden>
        <div class="dialog-actions">
          <button class="btn ghost" type="button" value="cancel">Annulla</button>
          <button class="btn" type="submit" value="ok"></button>
        </div>
      </form>`;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('.ask-message').textContent = message;
    const field = dialog.querySelector('.ask-input');
    const ok = dialog.querySelector('[value="ok"]');
    ok.textContent = confirmText;
    if (danger) ok.classList.add('danger');
    if (input !== null || requireText) {
      field.hidden = false;
      field.maxLength = maxLength;
      field.value = input ?? '';
      if (requireText) {
        field.placeholder = requireText;
        ok.disabled = true;
        field.addEventListener('input', () => { ok.disabled = field.value.trim().toUpperCase() !== requireText; });
      }
    }
    let result = null;
    dialog.querySelector('[value="cancel"]').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      if (ok.disabled) return;
      result = input !== null ? field.value.trim() : true;
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    if (!field.hidden) field.focus();
  });
}

/** Breve messaggio in basso. */
export function notify(text, { error = false, ms = 3500 } = {}) {
  const el = document.createElement('div');
  el.className = `notice${error ? ' error' : ''}`;
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}
