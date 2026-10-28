import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const S = new URL('.', import.meta.url).pathname.replace(/\/$/, ''); // cartella tools/qa
const QA = fs.readFileSync(`${S}/qa.js`, 'utf8');
const theme = process.argv[2] || 'light';
const only = process.argv[3];
const C = `localStorage.setItem('xair.theme','${theme}');localStorage.setItem('xair.tour','done');localStorage.removeItem('xair.view');document.getElementById('ip-input').value='127.0.0.1';document.getElementById('ip-form').requestSubmit()`;
const EX = `document.querySelector('.monitor-view')&&!document.querySelector('.monitor-view').hidden&&document.querySelector('.mon-exit').click()`;
const tab = g => `document.querySelector('.topbar .tab[data-group=${g}]').click()`;
const open = (id, t) => `${tab('input')};document.querySelector('.strip[data-id=${id}] .label').click();[...document.querySelectorAll('.editor-tabs .tab')].find(x=>x.textContent==='${t}')?.click()`;
const sizes = { wide: [1440, 900], pc: [1280, 800], ipadL: [1180, 820], ipadP: [820, 1180], phone: [390, 844], phoneL: [844, 390] };
const screens = {
  ingressi: tab('input'), bus: tab('bus'), dca: tab('dca'), fx: tab('fx'), routing: tab('routing'), meter: tab('meters'),
  'ed-ingresso': open('ch13', 'Ingresso'), 'ed-gate': open('ch13', 'Gate'), 'ed-eq': open('ch13', 'EQ'), 'ed-comp': open('ch13', 'Compressore'),
  'ed-mandate': open('ch13', 'Mandate'), 'ed-gruppi': open('ch13', 'Gruppi'), 'ed-rtn-fx': open('rtn1', 'Effetto'),
  'dlg-connetti': `document.getElementById('connect-btn').click()`, 'dlg-scene': `document.getElementById('scenes-btn').click()`,
  'dlg-layer': `document.querySelector('.tab-add').click()`,
  'dlg-protetti': `document.getElementById('scenes-btn').click();document.querySelector('.scenes-dialog .tab[data-tab=safe]').click()`,
  'dlg-impostazioni': `document.getElementById('settings-btn').click()`, 'dlg-feedback': `document.getElementById('fb-btn').click()`,
  'dlg-vista': `document.getElementById('view-btn').click()`, 'dlg-libreria': `${tab('fx')};document.querySelector('.fx-toolbar .btn').click()`,
  monitor: `${tab('input')};document.getElementById('monitor-btn').click()`,
};
for (const [sz, [w, h]] of Object.entries(sizes)) {
  if (only && sz !== only) continue;
  for (const [name, act] of Object.entries(screens)) {
    if (sz !== 'pc' && sz !== 'phone' && name.startsWith('dlg')) continue; // finestre: basta pc e telefono
    const file = `${S}/out/${theme}-${sz}-${name}.png`;
    let r = '';
    try { r = execFileSync('osascript', ['-l', 'JavaScript', `${S}/shot.js`, 'http://localhost:8091/', file, String(w), String(h), '2', `${C};;${EX};;${act};;void 0`, QA], { encoding: 'utf8', timeout: 60000 }); } catch (e) { r = 'ERRORE ' + e.message; }
    const rep = r.split('\n').slice(1).join('\n').trim();
    if (rep !== 'nessun problema') console.log(`== ${theme} ${sz} ${name}\n${rep}`);
  }
}
console.log('fine', theme, only || 'tutti');
