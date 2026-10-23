# Controllo grafico

Fotografa ogni schermata e finestra dell'app con il motore di Safari (WKWebView, tramite `osascript`)
nei formati computer, iPad e telefono, e segnala testi che escono dal riquadro e controlli sovrapposti.

1. Avvia simulatore su 10024 e ponte su 8091 (es. `node -e "import('./server/simulator.js').then(m=>m.startSimulator());import('./server/bridge.js').then(m=>m.startBridge({port:8091}))"`).
2. `node tools/qa/qa-run.mjs light` (oppure `dark`; terzo argomento opzionale: `pc`, `ipadL`, `ipadP`, `phone`, `phoneL`).
3. Le immagini finiscono in `tools/qa/out/`; a schermo solo i problemi trovati.

## Prove automatiche dell'interfaccia

`cd tools/test && npm install && npm test`: l'app vera in jsdom collegata al simulatore (porte 10031/8097):
connessione, trascinamento del fader fino al mixer, fader che non salta mentre lo si tiene, schede, Vista,
pannello canale, monitor, Annulla/Ripeti (anche da tastiera), movimento fine, doppio tocco, blocco, copia/incolla, canali protetti con uno snapshot, layer.
