// Finestra "Il tuo account": stato della prova o della licenza, accesso con email e codice,
// i 3 dispositivi (con "Libera" per cambiarne uno) e "Esci da questo dispositivo".
// Pochi passi, uno alla volta: email → codice → attivo. Senza internet spiega che serve solo qui.

import { MAX_DEVICES } from './license.js';
import { t } from './i18n.js';

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

const ERRORS = {
  offline: 'Serve internet per questo passaggio. Il resto dell’app funziona anche senza.',
  'bad-email': 'Controlla l’email: sembra scritta male.',
  'bad-code': 'Codice sbagliato o scaduto. Chiedine uno nuovo.',
  'no-license': 'Questa email non ha ancora una licenza.',
  session: 'Accedi di nuovo con la tua email.',
  server: 'Qualcosa non ha funzionato. Riprova tra poco.',
};

/** license: createLicense(...). platform: 'ios' | 'android' | 'web'. buyUrl: pagina di acquisto. */
export function createAccount({ license, platform, buyUrl, openUrl = url => window.open(url, '_blank', 'noopener') }) {
  const canBuy = !!buyUrl && platform !== 'ios'; // su iPhone l'acquisto sarà dentro l'app (regole di Apple)

  const dialog = h('dialog', 'account-dialog');
  dialog.innerHTML = `
    <div class="dialog-head">
      <h2>Il tuo account</h2>
      <button class="icon-btn ac-close" type="button" aria-label="Chiudi">✕</button>
    </div>
    <div class="ac-status"><span class="ac-badge"></span><div><strong class="ac-title"></strong><p class="ac-detail"></p></div></div>
    <p class="ac-error" role="alert" hidden></p>
    <div class="ac-body"></div>`;
  document.body.append(dialog);
  const $ = sel => dialog.querySelector(sel);
  const body = $('.ac-body');
  const errorEl = $('.ac-error');
  $('.ac-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

  let step = 'email'; // email | code | devices
  let busy = false;
  let deviceList = null;
  let limitReached = false;

  const showError = code => {
    errorEl.textContent = code ? t(ERRORS[code] ?? ERRORS.server) : '';
    errorEl.hidden = !code;
  };

  async function run(fn) {
    if (busy) return;
    busy = true;
    dialog.classList.add('busy');
    showError(null);
    try { await fn(); } catch (e) { showError(e.code ?? 'server'); if (e.code === 'limit') { limitReached = true; deviceList = e.data.devices; step = 'devices'; } if (e.code === 'session') step = 'email'; }
    busy = false;
    dialog.classList.remove('busy');
    render();
  }

  function renderStatus() {
    const s = license.state();
    const card = $('.ac-status');
    card.dataset.kind = s.kind;
    const [title, detail] = {
      licensed: ['AirDesk è attivo', t('Collegato a {0}. Funziona anche senza internet.', s.email ?? '')],
      trial: [t('Prova gratuita: {0} giorni rimasti', s.daysLeft), 'Tutte le funzioni sbloccate. Poi serve la licenza per collegarsi al mixer.'],
      'trial-unstarted': [t('{0} giorni di prova gratuita', s.daysLeft), 'Partono al primo collegamento a un mixer.'],
      expired: ['La prova è finita', 'Per collegarti al mixer accedi con l’email con cui hai comprato AirDesk. Il mixer virtuale resta libero.'],
    }[s.kind] ?? ['', ''];
    $('.ac-title').textContent = title;
    $('.ac-detail').textContent = detail;
  }

  function buyButton() {
    if (!canBuy) return null;
    const b = h('button', 'btn ac-buy', 'Acquista AirDesk');
    b.type = 'button';
    b.addEventListener('click', () => openUrl(buyUrl));
    return b;
  }

  function emailStep() {
    const form = h('form', 'ac-form');
    form.innerHTML = `
      <label class="ac-label" for="ac-email">Email</label>
      <input id="ac-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required>
      <p class="fx-note">Ti mandiamo un codice di 6 cifre. Niente password.</p>
      <div class="dialog-actions"><button class="btn" type="submit">Ricevi il codice</button></div>`;
    const input = form.querySelector('input');
    input.value = license.email() ?? '';
    form.addEventListener('submit', e => {
      e.preventDefault();
      run(async () => { await license.requestCode(input.value); step = 'code'; });
    });
    const buy = buyButton();
    if (buy) {
      const row = h('p', 'ac-buy-row', 'Non hai ancora la licenza? ');
      row.append(buy);
      return [form, row];
    }
    return [form];
  }

  function codeStep() {
    const form = h('form', 'ac-form');
    form.innerHTML = `
      <label class="ac-label" for="ac-code"></label>
      <input id="ac-code" class="ac-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
      <div class="dialog-actions">
        <button class="btn ghost ac-back" type="button">Cambia email</button>
        <button class="btn" type="submit">Accedi</button>
      </div>`;
    form.querySelector('label').textContent = t('Codice inviato a {0}', license.email() ?? '');
    form.querySelector('.ac-back').addEventListener('click', () => { step = 'email'; showError(null); render(); });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const code = form.querySelector('input').value;
      run(async () => {
        await license.login(code);
        step = 'devices';
        try { deviceList = await license.activate(); limitReached = false; }
        catch (err) {
          if (err.code === 'no-license') { step = 'email'; throw err; }
          throw err;
        }
      });
    });
    return [form];
  }

  function devicesStep() {
    const out = [];
    const me = license.deviceId();
    const list = deviceList ?? [];
    const head = h('h3', 'ac-devices-title', t('I tuoi dispositivi: {0} di {1}', list.length, MAX_DEVICES));
    out.push(head);
    if (limitReached) out.push(h('p', 'fx-note', 'Hai già 3 dispositivi. Liberane uno per usare AirDesk qui: potrai riattivarlo quando vuoi.'));
    const ul = h('ul', 'ac-devices');
    for (const d of list) {
      const li = h('li', 'ac-device');
      const info = h('div', 'ac-device-info');
      info.append(h('strong', null, d.name || t('Dispositivo')));
      if (d.since) info.append(h('span', null, t('dal {0}', new Date(d.since).toLocaleDateString())));
      li.append(info);
      if (d.id === me) li.append(h('span', 'ac-this', 'Questo dispositivo'));
      else {
        const free = h('button', 'btn ghost ac-free', 'Libera');
        free.type = 'button';
        free.addEventListener('click', () => run(async () => {
          deviceList = await license.removeDevice(d.id);
          if (limitReached) { deviceList = await license.activate(); limitReached = false; }
        }));
        li.append(free);
      }
      ul.append(li);
    }
    out.push(ul);
    if (license.state().kind === 'licensed') {
      const leave = h('button', 'btn ghost danger-text ac-leave', 'Esci da questo dispositivo');
      leave.type = 'button';
      leave.addEventListener('click', () => run(async () => { await license.signOut(); step = 'email'; deviceList = null; }));
      out.push(h('p', 'fx-note', 'Uscendo liberi il posto: AirDesk qui torna senza licenza.'), leave);
    }
    return out;
  }

  function render() {
    renderStatus();
    body.innerHTML = '';
    const view = step === 'code' ? codeStep() : step === 'devices' && license.hasSession() ? devicesStep() : emailStep();
    body.append(...view);
    // dopo "Ricevi il codice" la tastiera numerica è già pronta
    if (step === 'code') queueMicrotask(() => body.querySelector('.ac-code')?.focus());
  }

  async function open() {
    showError(null);
    const s = license.state();
    if (s.kind === 'licensed' && license.hasSession()) {
      step = 'devices';
      render();
      dialog.showModal();
      run(async () => { deviceList = await license.devices(); });
      return;
    }
    if (s.kind === 'licensed') step = 'devices';
    else if (step === 'devices' && !limitReached) step = 'email';
    render();
    dialog.showModal();
  }

  /** Riga per le Impostazioni: stato in breve + "Gestisci". */
  function summary() {
    const row = h('div', 'ac-summary');
    const text = h('span', 'ac-summary-text');
    const btn = h('button', 'btn ghost', 'Gestisci account');
    btn.type = 'button';
    btn.addEventListener('click', open);
    const sync = () => {
      const s = license.state();
      text.textContent = s.kind === 'licensed' ? t('Attivo · {0}', s.email)
        : s.kind === 'trial' ? t('Prova gratuita: {0} giorni rimasti', s.daysLeft)
        : s.kind === 'expired' ? t('La prova è finita') : t('{0} giorni di prova gratuita', s.daysLeft);
    };
    license.onChange(sync);
    sync();
    row.append(text, btn);
    return row;
  }

  license.onChange(() => { if (dialog.open) renderStatus(); });
  return { open, summary };
}
