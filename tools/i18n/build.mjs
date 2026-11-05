// Crea i dizionari public/js/lang/{en,es,fr,de}.js dalle tabelle tools/i18n/*.tsv
// (italiano§inglese§spagnolo§francese§tedesco). Uso: node tools/i18n/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, '../../public/js/lang');
const LANGS = ['en', 'es', 'fr', 'de'];
const dicts = Object.fromEntries(LANGS.map(l => [l, {}]));
const seen = new Map();
let problems = 0;

for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.tsv') && !f.startsWith('.')).sort()) {
  fs.readFileSync(path.join(DIR, file), 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const cols = line.split('§').map(c => c.replace(/\\n/g, '\n'));
    while (cols.length > 5 && cols[cols.length - 1] === '') cols.pop();
    const where = `${file}:${i + 1}`;
    if (cols.length !== 5 || cols.some(c => !c.trim())) {
      console.log(`${where}: servono 5 colonne non vuote, trovate ${cols.length}`);
      problems++;
      return;
    }
    const [it, ...tr] = cols;
    if (seen.has(it)) console.log(`${where}: "${it}" già in ${seen.get(it)} (vale l'ultima)`);
    seen.set(it, where);
    const holes = s => (s.match(/\{#?\d\}/g) ?? []).map(h => h.replace('#', '')).sort().join();
    tr.forEach((t, j) => {
      if (holes(t) !== holes(it)) {
        console.log(`${where}: segnaposto diversi in ${LANGS[j]}: "${t}"`);
        problems++;
      }
      dicts[LANGS[j]][it] = t;
    });
  });
}

for (const l of LANGS) {
  const body = JSON.stringify(dicts[l], null, 1).replace(/^ /gm, '  ');
  fs.writeFileSync(path.join(OUT, `${l}.js`), `// Generato da tools/i18n/build.mjs: non modificare a mano, cambia le tabelle .tsv.\nexport default ${body};\n`);
}
console.log(`${seen.size} testi in ${LANGS.length} lingue${problems ? `, ${problems} problemi` : ''}`);
process.exitCode = problems ? 1 : 0;
