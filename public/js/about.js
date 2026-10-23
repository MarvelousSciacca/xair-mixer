// Informazioni e note legali mostrate nelle Impostazioni: licenza, marchi, privacy, componenti di terze
// parti e avvertenze d'uso. Gli stessi testi completi sono in LICENSE, PRIVACY.md e THIRD-PARTY-NOTICES.md.

const MIT = `MIT License

Copyright (c) 2026 MarvelousSciacca

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const PARTS = [
  ['Avvertenze d\'uso', [
    'Un mixer può produrre livelli sonori dannosi per l\'udito: fai le prime prove a volume basso.',
    'La phantom (+48V) può danneggiare microfoni a nastro e alcune sorgenti: controlla prima di accenderla.',
    'Il mixer non ha password: chiunque sia sulla sua rete Wi-Fi può comandarlo con qualsiasi app. Proteggi la rete del mixer con una password.',
  ]],
  ['Marchi', [
    'AirDesk è un progetto indipendente: non è affiliato, approvato o sponsorizzato da Behringer o Music Tribe.',
    'Behringer, X AIR, XR12, XR16, XR18, X18, X-AIR-Edit e Ultranet sono marchi dei rispettivi proprietari, citati solo per indicare la compatibilità.',
  ]],
  ['Privacy', [
    'AirDesk non raccoglie, non invia e non vende dati personali: niente account, pubblicità, statistiche o tracciamento.',
    'L\'app parla solo con il mixer sulla rete locale. Le preferenze restano su questo dispositivo e si cancellano disinstallando l\'app.',
  ]],
  ['Componenti di terze parti', [
    'Capacitor (MIT), ws (MIT), Electron (MIT) con Chromium e Node.js (licenze incluse nell\'app per computer), AndroidX e Apache Cordova (Apache-2.0).',
  ]],
];

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

export function aboutSection() {
  const box = h('div', 'about');
  box.append(h('p', 'about-lead', 'AirDesk · controller per mixer digitali compatibili con Behringer X Air (XR12, XR16, XR18). Software libero con licenza MIT, fornito senza garanzie.'));
  for (const [title, lines] of PARTS) {
    const d = h('details', 'about-part');
    d.append(h('summary', null, title));
    for (const line of lines) d.append(h('p', null, line));
    box.append(d);
  }
  const lic = h('details', 'about-part');
  lic.append(h('summary', null, 'Licenza (MIT)'), h('pre', 'about-license', MIT));
  box.append(lic);
  return box;
}
