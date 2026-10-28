// Tutorial al primo avvio: una serie di schede che illuminano i comandi principali.
// Si può saltare in ogni momento e rivedere da Impostazioni. Mostrato una volta sola (xair.tour).

const DONE_KEY = 'xair.tour';

const STEPS = [
  {
    title: 'Benvenuto in AirDesk',
    text: 'Con AirDesk controlli il tuo mixer digitale dal telefono, dal tablet o dal computer. In un minuto ti mostro i comandi principali.',
  },
  {
    target: '#connect-btn',
    title: 'Collegati al mixer',
    text: 'Collega il dispositivo alla stessa rete Wi-Fi del mixer, poi tocca qui: AirDesk lo cerca da solo, oppure puoi scriverne l’indirizzo IP.',
  },
  {
    target: '.topbar .tabs',
    title: 'Le sezioni',
    text: 'Ingressi, Bus ed effetti, DCA, Effetti, Routing e Meter. Con “+ Layer” crei una pagina con solo i canali che ti servono.',
  },
  {
    target: '.mixer .strip:not([hidden]):not(.user-hidden)',
    title: 'Un canale',
    text: 'Trascina il fader per il volume. Per una regolazione fine, mentre lo muovi allontana il dito di lato; con un doppio tocco torna a 0 dB. Tocca Gain, Gate, Comp o EQ per aprire il canale, il nome per cambiarlo.',
  },
  {
    target: '.history',
    title: 'Annulla e Ripeti',
    text: 'Ogni modifica si può annullare, anche un intero movimento del fader.',
  },
  {
    target: '#monitor-btn',
    title: 'Monitor in-ear',
    text: 'Una schermata con un solo mix monitor: i fader regolano solo quello. Comoda da dare a un musicista.',
  },
  {
    target: '#scenes-btn',
    title: 'Scene e snapshot',
    text: 'Salva e richiama i tuoi mix. I canali che proteggi non cambiano quando carichi una scena.',
  },
  {
    target: '#fb-btn',
    title: 'Rilevatore feedback',
    text: 'Usa “Soundcheck” per cercare il feedback a microfoni aperti e “Concerto” mentre suoni.',
  },
  {
    target: '#lock-btn',
    title: 'Blocco',
    text: 'Blocca i comandi contro i tocchi per sbaglio. Per sbloccare, tieni premuto.',
  },
  {
    title: 'Tutto pronto',
    text: 'Ogni comando arriva subito al mixer: occhio al volume e alla +48V. Puoi rivedere questo tutorial da Impostazioni.',
  },
];

const PAD = 6; // margine dell'evidenziazione intorno al comando

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/** Il comando da illuminare, se c'è ed è visibile in questo formato dello schermo. */
function visibleTarget(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

export function tourDone(storage) {
  return storage.get(DONE_KEY) === 'done';
}

/**
 * Avvia il tutorial. onClose() viene chiamata alla fine o quando lo si salta.
 * Restituisce { close } per chiuderlo da fuori.
 */
export function startTour({ storage, onClose = () => {} }) {
  const dialog = h('dialog', 'tour');
  dialog.setAttribute('aria-labelledby', 'tour-title');
  // velo scuro con un buco intorno al comando (SVG: l'ombra enorme non viene disegnata da tutti i browser)
  const veil = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  veil.setAttribute('class', 'tour-veil');
  veil.setAttribute('aria-hidden', 'true');
  const veilPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  veilPath.setAttribute('fill-rule', 'evenodd');
  veil.append(veilPath);
  const spot = h('div', 'tour-spot');
  const card = h('div', 'tour-card');
  card.innerHTML = `
    <div class="tour-count"></div>
    <h2 id="tour-title"></h2>
    <p class="tour-text"></p>
    <div class="tour-actions">
      <button class="btn ghost tour-skip" type="button">Salta</button>
      <span class="spacer"></span>
      <button class="btn ghost tour-back" type="button">Indietro</button>
      <button class="btn tour-next" type="button"></button>
    </div>`;
  dialog.append(veil, spot, card);
  document.body.append(dialog);
  const $ = sel => card.querySelector(sel);

  let index = 0;
  let closed = false;

  function place() {
    const step = STEPS[index];
    const target = visibleTarget(step.target);
    const vw = window.innerWidth, vh = window.innerHeight;
    const outer = `M0 0H${vw}V${vh}H0Z`;
    dialog.classList.toggle('centered', !target);
    if (!target) {
      veilPath.setAttribute('d', outer);
      spot.hidden = true;
      card.style.left = card.style.top = '';
      return;
    }
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const r = target.getBoundingClientRect();
    const x = r.left - PAD, y = r.top - PAD, w = r.width + 2 * PAD, hh = r.height + 2 * PAD, k = 12;
    veilPath.setAttribute('d', `${outer}M${x + k} ${y}H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + hh - k}A${k} ${k} 0 0 1 ${x + w - k} ${y + hh}H${x + k}A${k} ${k} 0 0 1 ${x} ${y + hh - k}V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`);
    spot.hidden = false;
    Object.assign(spot.style, {
      left: `${r.left - PAD}px`, top: `${r.top - PAD}px`,
      width: `${r.width + 2 * PAD}px`, height: `${r.height + 2 * PAD}px`,
    });
    // la scheda sotto il comando se c'è posto, altrimenti sopra; sempre dentro lo schermo
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const below = r.bottom + PAD + 12;
    const top = below + ch <= vh - 12 ? below : Math.max(12, r.top - PAD - 12 - ch);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function render() {
    const step = STEPS[index];
    $('.tour-count').textContent = `${index + 1} di ${STEPS.length}`;
    $('#tour-title').textContent = step.title;
    $('.tour-text').textContent = step.text;
    $('.tour-back').hidden = index === 0;
    $('.tour-next').textContent = index === 0 ? 'Iniziamo' : index === STEPS.length - 1 ? 'Fine' : 'Avanti';
    $('.tour-skip').hidden = index === STEPS.length - 1;
    place();
    $('.tour-next').focus();
  }

  function close() {
    if (closed) return;
    closed = true;
    storage.set(DONE_KEY, 'done');
    window.removeEventListener('resize', place);
    dialog.close();
    dialog.remove();
    onClose();
  }

  const go = delta => {
    if (index + delta >= STEPS.length) return close();
    index = Math.max(0, index + delta);
    render();
  };

  $('.tour-next').addEventListener('click', () => go(1));
  $('.tour-back').addEventListener('click', () => go(-1));
  $('.tour-skip').addEventListener('click', close);
  dialog.addEventListener('cancel', e => {
    e.preventDefault(); // Esc: salta il tutorial (chiusura ordinata)
    close();
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });
  window.addEventListener('resize', place);

  dialog.showModal();
  render();
  return { close };
}
