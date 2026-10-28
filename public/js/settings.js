// Impostazioni del mixer: informazioni, solo, opzioni del link stereo, patch delle uscite,
// rilettura dei parametri e inizializzazione (con backup automatico prima).

import { SETTINGS, SNAPSHOTS, INIT_COMMAND } from './model.js';
import { Scope, knob, toggle, choice } from './controls.js';
import { ZERO_DB } from './mixer.js';
import { ask, notify } from './dialogs.js';
import { captureScene, downloadScene } from './scenes.js';
import { THEMES, setTheme, currentTheme } from './theme.js';
import { aboutSection } from './about.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad2 = n => String(n).padStart(2, '0');

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function section(title, ...children) {
  const sec = h('section', 'ed-section');
  sec.append(h('h3', null, title));
  const row = h('div', 'ed-row');
  row.append(...children);
  sec.append(row);
  return sec;
}

export function createSettings({ mixer, addresses, onReload, onTour }) {
  const dialog = h('dialog', 'settings-dialog');
  dialog.innerHTML = `
    <div class="dialog-head">
      <h2>Impostazioni mixer</h2>
      <button class="icon-btn st-close" type="button" aria-label="Chiudi">✕</button>
    </div>
    <div class="st-body"></div>`;
  document.body.append(dialog);
  const body = dialog.querySelector('.st-body');
  dialog.querySelector('.st-close').addEventListener('click', () => dialog.close());

  const sc = new Scope(mixer);
  const bool = label => ({ kind: 'bool', label, def: 1 });

  const info = h('dl', 'st-info');
  const renderInfo = () => {
    const i = mixer.info ?? {};
    info.innerHTML = '';
    for (const [k, v] of [['Nome', i.name], ['Modello', i.model], ['Firmware', i.version], ['Indirizzo IP', i.ip ?? mixer.ip]]) {
      info.append(h('dt', null, k), h('dd', null, v ?? '—'));
    }
  };
  mixer.onStatus(renderInfo);


  const tour = h('button', 'btn ghost', 'Rivedi il tutorial');
  tour.type = 'button';
  tour.addEventListener('click', () => {
    dialog.close();
    onTour?.();
  });

  const reload = h('button', 'btn ghost', 'Rileggi tutti i parametri');
  reload.type = 'button';
  reload.addEventListener('click', () => {
    onReload();
    notify('Rilettura dei parametri dal mixer…');
  });
  const init = h('button', 'btn danger', 'Inizializza mixer…');
  init.type = 'button';
  init.addEventListener('click', initialize);

  // Aspetto: tema chiaro/scuro (salvato su questo dispositivo, non sul mixer)
  const themeBox = h('div', 'segmented');
  const themeButtons = THEMES.map(([id, label]) => {
    const b = h('button', null, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      setTheme(id);
      themeButtons.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    b.setAttribute('aria-pressed', String(currentTheme() === id));
    themeBox.append(b);
    return b;
  });

  body.append(
    section('Aspetto', themeBox),
    section('Mixer', info),
    section('Solo / cuffie',
      knob(sc, SETTINGS.soloLevel, { kind: 'fader', label: 'Livello solo', def: ZERO_DB }, { reset: ZERO_DB }),
      toggle(sc, SETTINGS.soloMono, { kind: 'bool', label: 'Mono', def: 0 })),
    section('Il link stereo collega anche',
      toggle(sc, SETTINGS.linkEq, bool('EQ')),
      toggle(sc, SETTINGS.linkDyn, bool('Dinamiche')),
      toggle(sc, SETTINGS.linkFader, bool('Fader e mute'))),
    section('Routing', h('p', 'fx-note', 'Ingressi, uscite USB, Aux e Ultranet si impostano nella scheda Routing.')),
    section('Tutorial', tour),
    section('Manutenzione', reload, init),
    section('Informazioni e note legali', aboutSection()),
  );

  async function initialize() {
    const free = Array.from({ length: SNAPSHOTS.count }, (_, i) => i + 1).find(n => !mixer.get(SNAPSHOTS.name(n)));
    const stamp = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    const ok = await ask({
      title: 'Inizializzare il mixer?',
      message: `Tutte le impostazioni del mix tornano ai valori di fabbrica. Prima verrà scaricata una scena di backup su file`
        + `${free ? ` e salvato il mix attuale nello snapshot ${pad2(free)}` : ''}. Gli snapshot salvati restano.`
        + ' Abbassa il volume dell\'impianto. Scrivi INIZIALIZZA per confermare.',
      requireText: 'INIZIALIZZA',
      confirmText: 'Inizializza',
      danger: true,
    });
    if (!ok) return;

    downloadScene(captureScene(mixer, addresses, `Backup ${stamp}`));
    if (free) {
      mixer.command(SNAPSHOTS.save, [{ type: 'i', value: free }]);
      await sleep(500);
      mixer.set(SNAPSHOTS.name(free), `Backup ${stamp}`.slice(0, 24), 's');
      await sleep(500);
    }

    // Per capire se il mixer ha eseguito il comando si confrontano alcuni valori prima e dopo.
    const probe = addresses.filter(a => /\/(config\/name|mix\/fader)$/.test(a));
    const before = probe.map(a => mixer.get(a));
    mixer.command(INIT_COMMAND, [{ type: 'i', value: 1 }]);
    mixer.clearHistory();
    notify('Inizializzazione in corso…');
    await sleep(1500);
    onReload();
    await sleep(5000);
    const changed = probe.some((a, i) => mixer.get(a) !== before[i]);
    notify(changed
      ? 'Mixer inizializzato. Il backup è nella cartella Download' + (free ? ` e nello snapshot ${pad2(free)}.` : '.')
      : 'Il mixer non ha eseguito l\'inizializzazione (comando non riconosciuto): nessuna modifica.', { error: !changed, ms: 7000 });
  }

  return {
    open() {
      renderInfo();
      mixer.query([...Object.values(SETTINGS), ...Array.from({ length: SNAPSHOTS.count }, (_, i) => SNAPSHOTS.name(i + 1))], { priority: true });
      dialog.showModal();
    },
  };
}
