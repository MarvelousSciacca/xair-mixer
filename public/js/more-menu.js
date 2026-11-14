// Telefono: la barra in alto tiene solo stato, Annulla, Blocco e Connetti; il resto (monitor, scene,
// feedback, vista, impostazioni) sta in "Altro", con le icone e i nomi scritti. Le voci premono i
// pulsanti veri, che sul telefono sono nascosti (strip.css): un solo comportamento, due posti.
// Sui telefoni la barra delle sezioni scorre: una sfumatura a destra dice che ce ne sono altre.

const ITEMS = [
  ['monitor-btn', 'Monitor in-ear'],
  ['scenes-btn', 'Scene e snapshot'],
  ['fb-btn', 'Rilevatore feedback'],
  ['view-btn', 'Vista dei canali'],
  ['settings-btn', 'Impostazioni'],
];

export function initMoreMenu() {
  const btn = document.getElementById('more-btn');
  const dialog = document.getElementById('more-dialog');
  const list = dialog.querySelector('.more-list');
  for (const [id, label] of ITEMS) {
    const target = document.getElementById(id);
    if (!target) continue;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'more-item';
    item.dataset.for = id;
    const ico = target.querySelector('svg')?.cloneNode(true);
    if (ico) item.append(ico);
    const text = document.createElement('span');
    text.textContent = label;
    item.append(text);
    item.addEventListener('click', () => {
      dialog.close();
      target.click();
    });
    list.append(item);
  }
  // il rilevatore che segnala un feedback si vede anche da chiuso (pallino su Altro, vedi strip.css)
  const fb = document.getElementById('fb-btn');
  const syncFb = () => {
    const alert = fb?.dataset.state === 'alert';
    btn.classList.toggle('alert', alert);
    list.querySelector('[data-for="fb-btn"]')?.classList.toggle('alert', alert);
  };
  if (fb) new window.MutationObserver(syncFb).observe(fb, { attributes: true, attributeFilter: ['data-state'] });
  syncFb();
  btn.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('.more-close').addEventListener('click', () => dialog.close());
  // tocco fuori dal pannello: si chiude
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

  // sezioni che scorrono: sfumatura a destra finché ce ne sono altre da vedere
  const tabs = document.querySelector('.topbar .tabs');
  if (tabs) {
    const edge = () => tabs.classList.toggle('more-right', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 4);
    tabs.addEventListener('scroll', edge, { passive: true });
    window.addEventListener('resize', edge);
    edge();
    // la sezione scelta resta in vista
    tabs.addEventListener('click', e => e.target.closest('.tab')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }));
  }
}
