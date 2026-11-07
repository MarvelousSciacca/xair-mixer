// Icone e schermate di avvio di AirDesk secondo la ricetta Ottava Lab: fondo nero, pittogramma a linea
// in inchiostro con lo spessore dell'anello del segno (6/128), un solo intarsio arancione.
// Il pittogramma: tre fader. I binari sono linee, i cursori pieni; quello centrale è l'intarsio.
//
// Uso (dalla cartella del progetto): desktop/node_modules/.bin/electron tools/icons/render.cjs
// Scrive tutte le PNG di Android, iOS e app per computer, e public/img/icon.svg.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const INK = '#f5f5f7';       // ink del tema scuro
const SIGNAL = '#ff5a1f';    // l'intarsio
const SURFACE = '#000000';   // fondo dell'icona e dell'avvio

// pittogramma su una tela 1024 × 1024 (griglia 128 × 8)
const pictogram = () => {
  const s = 48; // 6/128 di 1024
  const tracks = [352, 512, 672];
  const caps = [{ y: 584, c: INK }, { y: 392, c: SIGNAL }, { y: 520, c: INK }];
  return tracks.map((x, i) => `<line x1="${x}" y1="288" x2="${x}" y2="736" stroke="${INK}" stroke-width="${s}" stroke-linecap="round"/>`
    + `<rect x="${x - 76}" y="${caps[i].y - 34}" width="152" height="68" rx="34" fill="${caps[i].c}"/>`).join('');
};
// scale: quanto è grande il pittogramma rispetto alla tela (1 = come nell'icona)
const group = (size, scale = 1) => `<g transform="translate(${size / 2} ${size / 2}) scale(${(size / 1024) * scale * 1.2}) translate(-512 -512)">${pictogram()}</g>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const ICONS = {
  // quadrata piena: iOS (l'angolo lo mette il sistema) e icona web
  square: size => svg(size, size, `<rect width="${size}" height="${size}" fill="${SURFACE}"/>${group(size)}`),
  // con l'angolo 28/128: icona Android classica
  rounded: size => svg(size, size, `<rect width="${size}" height="${size}" rx="${size * 28 / 128}" fill="${SURFACE}"/>${group(size)}`),
  round: size => svg(size, size, `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${SURFACE}"/>${group(size, 0.85)}`),
  // Android adattiva: solo il pittogramma (il fondo è il colore ic_launcher_background), nella zona sicura
  foreground: size => svg(size, size, group(size, 1.05)),
  // Mac: quadrato arrotondato con il margine delle icone di sistema (824 su 1024)
  mac: size => svg(size, size, `<rect x="${size * 100 / 1024}" y="${size * 100 / 1024}" width="${size * 824 / 1024}" height="${size * 824 / 1024}" rx="${size * 185 / 1024}" fill="${SURFACE}"/>${group(size, 824 / 1024)}`),
  // avvio: fondo nero, icona al centro (un quarto del lato corto)
  splash: (w, h) => svg(w, h, `<rect width="${w}" height="${h}" fill="${SURFACE}"/><g transform="translate(${w / 2} ${h / 2}) scale(${Math.min(w, h) / 4 / 1024 * 1.6}) translate(-512 -512)">${pictogram()}</g>`),
};

const RES = path.join(ROOT, 'android/app/src/main/res');
const jobs = [];
for (const [dpi, n] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  jobs.push([`${RES}/mipmap-${dpi}/ic_launcher.png`, ICONS.rounded(n), n, n]);
  jobs.push([`${RES}/mipmap-${dpi}/ic_launcher_round.png`, ICONS.round(n), n, n]);
  jobs.push([`${RES}/mipmap-${dpi}/ic_launcher_foreground.png`, ICONS.foreground(n * 2.25), n * 2.25, n * 2.25]);
}
for (const dir of fs.readdirSync(RES).filter(d => d.startsWith('drawable'))) {
  const f = `${RES}/${dir}/splash.png`;
  if (!fs.existsSync(f)) continue;
  const [, w, h] = String(require('child_process').execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', f])).match(/pixelWidth: (\d+)[\s\S]*pixelHeight: (\d+)/);
  jobs.push([f, ICONS.splash(+w, +h), +w, +h]);
}
jobs.push([path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), ICONS.square(1024), 1024, 1024]);
for (const n of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  jobs.push([path.join(ROOT, 'ios/App/App/Assets.xcassets/Splash.imageset', n), ICONS.splash(2732, 2732), 2732, 2732]);
jobs.push([path.join(ROOT, 'desktop/build/icon.png'), ICONS.mac(1024), 1024, 1024]);
const preview = process.argv.find(a => a.startsWith('--preview='))?.slice(10);
if (preview) jobs.splice(0, jobs.length, [preview, ICONS.square(1024), 1024, 1024]);

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  for (const [file, body, w, h] of jobs) {
    win.setContentSize(Math.round(w), Math.round(h));
    await win.loadURL(`data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${body}</body></html>`)}`);
    await new Promise(r => setTimeout(r, 60));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: Math.round(w), height: Math.round(h) });
    fs.writeFileSync(file, img.resize({ width: Math.round(w), height: Math.round(h), quality: 'best' }).toPNG());
    console.log('scritta', path.relative(ROOT, file));
  }
  if (!preview) fs.writeFileSync(path.join(ROOT, 'public/img/icon.svg'), ICONS.square(1024) + '\n');
  app.quit();
});
