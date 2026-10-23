# X Air Mixer

Controller per i mixer Behringer X Air (XR12 / XR16 / XR18 / X18) che funziona su qualsiasi dispositivo con un browser.

## Avvio

```bash
npm install
npm start        # con il mixer vero
npm run dev      # con il simulatore XR18 incluso (nessun mixer necessario)
```

Poi apri `http://localhost:8080` su questo computer, oppure l'indirizzo "altri dispositivi" mostrato nel terminale
su iPhone, iPad, Android o un altro PC collegato alla stessa rete.

## Come funziona

```
browser (HTML/JS)  ──WebSocket──▶  ponte Node (server/bridge.js)  ──OSC/UDP :10024──▶  mixer X Air
```

I browser non possono usare UDP, quindi il ponte traduce i messaggi. Nelle future versioni app
(Electron per desktop, Capacitor per iOS/Android) il trasporto sarà UDP nativo e il ponte non servirà.

| Cartella | Contenuto |
|---|---|
| `server/osc.js` | codifica/decodifica OSC |
| `server/bridge.js` | server web + ponte WebSocket ↔ UDP, ricerca mixer in rete |
| `server/simulator.js` | simulatore XR18 su 127.0.0.1:10024 |
| `public/js/mixer.js` | stato del mixer, keepalive `/xremote`, meter, legge del fader, cronologia Annulla/Ripeti |
| `public/js/clipboard.js` | copia/incolla delle impostazioni tra canali, per sezioni (mai gain e +48V) |
| `public/js/safes.js` | canali protetti: non cambiano caricando scene e snapshot |
| `public/js/layers.js` | layer personalizzati: schede con i canali scelti, nell'ordine scelto |
| `public/js/stage.js` | per il palco: pulsanti Annulla/Ripeti, blocco dei comandi, schermo sempre acceso |
| `public/js/model.js` | canali, bus, indirizzi OSC, colori |
| `public/js/ui.js` | channel strip, fader, pan, meter |
| `public/js/app.js` | avvio, connessione, schede, editor nome/colore |
| `public/js/params.js` | parametri di preamp, gate, EQ, compressore: indirizzi, range, conversioni |
| `public/js/controls.js` | manopole, interruttori, selettori collegati ai parametri |
| `public/js/graphs.js` | grafico EQ (nodi trascinabili) e curve di gate/compressore |
| `public/js/editor.js` | pannello di elaborazione del canale |
| `public/js/dsp.js` | matematica dei filtri e bande RTA (condivisa col simulatore) |
| `public/js/eq-ui.js` | EQ intuitivo: tipo di banda disegnato, zone dello spettro, punti di partenza (Voce, Chitarra, Cassa, Basso) con Annulla |
| `public/js/geq-ui.js` | EQ grafici negli slot effetto (GEQ/TruEQ): cursori verticali da "disegnare" |
| `public/js/rta.js` | gestore RTA: alterna le sorgenti richieste dando priorità a quelle importanti |
| `public/js/feedback.js` | rilevatore di feedback sulle uscite e notch automatico |
| `public/js/feedback-ui.js` | pannello feedback, notifiche, evidenziazione strip |
| `public/js/fx.js` | tipi di effetto e parametri dei 4 slot FX |
| `public/js/fx-ui.js` | controlli di uno slot effetto (tipo e parametri) |
| `public/js/fx-rack.js` | scheda Effetti: i 4 slot affiancati |
| `public/js/fx-library.js` | libreria effetti: 61 effetti per categoria, ricerca, caricamento negli slot |
| `public/js/link.js` | link stereo di canali e bus: modifiche speculari, bilanciamento |
| `public/js/monitor.js` | modalità monitor in-ear (un bus, canali scelti, blocco) |
| `public/js/scenes.js` | snapshot nel mixer (carica/salva/rinomina/elimina) e scene su file |
| `public/js/settings.js` | impostazioni mixer: solo, opzioni link, patch uscite, inizializzazione con backup |
| `public/js/dialogs.js` | finestre di conferma e avvisi |
| `tools/` | diagnostiche da lanciare col mixer collegato (`probe.js`, `probe-rta.js`, `probe-snap.js`, `probe-src.js`, `probe-rta2.js`) |

## Stato

- [x] Fase 1 — ricerca mixer, connessione, fader, mute, solo, pan, meter, nomi e colori (16 canali, Aux/USB, 4 ritorni FX, 6 bus, 4 mandate FX, Main LR)
- [x] Fase 2 — preamp (gain, +48V, fase, low cut), gate, EQ 4/6 bande con grafico trascinabile, compressore, curve con livello in tempo reale
- [x] RTA dietro tutti i grafici EQ; rilevatore di feedback su Main LR e bus con notch manuale/automatico
- [x] Fase 3 — mandate a bus ed effetti con punto di prelievo, sends on fader, assegnazione Main LR, DCA, mute group, effetti (61 tipi con parametri, libreria per caricarli negli slot), insert
- [x] Link stereo (canali 1-2…15-16, bus 1-2/3-4/5-6) e modalità monitor in-ear (apribile con `?monitor=N&lock=1`)
- [x] Snapshot del mixer, scene su file, impostazioni (solo, link, patch Aux out/USB/Ultranet), inizializzazione con backup
- [x] Sorgenti d'ingresso (analogico / ritorno USB, trim USB, badge "USB" sulla strip) e automix (gruppi X/Y, peso)
- [x] Grafica rifinita (strip, barra con icone e layout per telefono), EQ più intuitivo, EQ grafici a cursori
- [x] App installabili (Android, iOS, macOS, Windows, Linux)
- [x] Per il palco: Annulla/Ripeti di ogni modifica (⌘Z/Ctrl+Z), blocco dei comandi (si sblocca tenendo premuto), schermo sempre acceso da collegati, movimento fine allontanando il dito di lato da fader e manopole, doppio tocco = 0 dB / valore di riposo
- [x] Copia/incolla tra canali per sezioni (fase e low cut, gate, EQ, compressore, mandate), canali protetti in scene e snapshot (un bus protetto protegge anche le mandate verso di lui), layer personalizzati

Da verificare con un mixer reale:
- range dei parametri degli effetti diversi da HALL, VRM, MODD, PLAT, D/CR;
- estremi di `/ch/NN/preamp/rtntrim` (ipotesi ±18 dB; 0.5 = 0 dB verificato);
- canali protetti con gli snapshot: il mixer carica lo snapshot intero e l'app rimette subito i canali protetti; da verificare sul mixer reale se si sente un salto;
- RTA: verificati `/meters/4` (100 bande), `/-stat/rta/source`, sorgenti 0-16; da confermare 17-31 (ritorni, bus, mandate, main).

Verificati il 14/10: snapshot `/-snap/save|load|delete ,i N` e rinomina (Diagnostica 3); sorgenti d'ingresso, trim USB, automix e scrittura di `/config/amixenable/X` (Diagnostica 4); parametri dei 4 effetti caricati (numero e tipo).

Da verificare: inizializzazione `/-action/initall`, sorgenti RTA 17-40 (Diagnostica 5).

Verificati su XR18V2 firmware 1.25 (diagnostica in `tools/probe.js` e `tools/probe-rta.js`): 2012 indirizzi su 2029, link, mandate, DCA, effetti, EQ a 4 bande su aux e ritorni FX.

Nel simulatore il pannello Feedback mostra il pulsante "Simula feedback" per provare il rilevatore.

## App Android

L'app usa la stessa interfaccia (`public/`) dentro Capacitor; al posto del ponte Node parla al mixer
in UDP con un plugin nativo (`android/app/src/main/java/it/xairmixer/app/UdpPlugin.java`,
lato JavaScript `public/js/transport-udp.js` e `public/js/osc.js`).

- Compilazione: GitHub Actions (`.github/workflows/android.yml`) a ogni push su `main`; l'APK finisce
  nella pagina Releases come `X-Air-Mixer.apk`.
- Firma: chiave in `keystore/` (solo sul Mac, esclusa da git) passata a GitHub come segreti
  `XAIR_KEYSTORE_BASE64` e `XAIR_KEYSTORE_PASSWORD`. **Non perderla**: senza la stessa chiave
  gli aggiornamenti non si installano sopra la versione precedente.
- Dopo modifiche a `public/`: `npx cap sync android` (lo fa anche la compilazione su GitHub).

## App iOS

Stessa interfaccia in Capacitor (`ios/`), plugin UDP in Swift (`ios/App/App/UdpPlugin.swift`, registrato da
`MainViewController`). Su iOS il broadcast richiede un permesso speciale di Apple: per trovare il mixer
`transport-udp.js` interroga anche gli indirizzi della rete Wi-Fi uno per uno (`interfaces` del plugin).

- Compilazione: GitHub Actions (`.github/workflows/ios.yml`), `.ipa` NON firmato nelle Releases (`ios-N`).
- Installazione per ora gratuita con Sideloadly + ID Apple (l'app scade dopo 7 giorni, va reinstallata).
  In futuro: account sviluppatore Apple + TestFlight (firma su GitHub con chiave API di App Store Connect).

## App per computer (macOS, Windows, Linux)

Electron (`desktop/`): il ponte Node (`server/bridge.js`) gira dentro l'app, solo su `127.0.0.1:47824`
(porta fissa così le preferenze restano tra un avvio e l'altro), e la finestra carica `public/`.

- Prova locale: `cd desktop && npm install && npm start`; installer: `npm run dist` (finisce in `desktop/dist/`).
- Compilazione: GitHub Actions (`.github/workflows/desktop.yml`) su Mac, Windows e Linux; release `desktop-N` con
  `.dmg` (universale), `Setup.exe`, `.AppImage` e `.deb`.
- Senza certificati: su macOS firma "ad hoc" (`desktop/build/adhoc-sign.cjs`), al primo avvio tasto destro → Apri;
  su Windows SmartScreen chiede "Ulteriori informazioni → Esegui comunque".
