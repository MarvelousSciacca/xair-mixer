// Avviso per i sistemi troppo vecchi. I fader si posizionano con translate e le unità cqh dei container
// (style.css), che richiedono iOS 16 o un WebView/Chrome 105: prima di quelle versioni l'app si apre ma i
// fader non stanno al loro posto, e su un mixer un livello mostrato male è un rischio. Lo si dice subito.

import { ask } from './dialogs.js';

const cssSupports = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' ? CSS.supports.bind(CSS) : null;

/** true se il motore grafico non sa posizionare i fader. Senza CSS.supports (prove automatiche) non avvisa. */
export const needsUpdate = (supports = cssSupports) => !!supports && !supports('translate', '0 calc(1cqh)');

/** Mostra l'avviso (a ogni avvio) se serve; si risolve quando viene chiuso. */
export function compatNotice(supports = cssSupports) {
  if (!needsUpdate(supports)) return Promise.resolve();
  return ask({
    title: 'Sistema da aggiornare',
    message: 'Questo dispositivo ha una versione del sistema troppo vecchia per AirDesk: i fader potrebbero non mostrare il livello giusto. Aggiorna a iOS 16 o successivo, oppure aggiorna Android System WebView dal Play Store. Se non puoi, usa un altro dispositivo.',
    confirmText: 'Ho capito',
    info: true,
  });
}
