// Tap tempo: si batte il tempo su un pulsante e il tempo del delay segue.
// Media degli ultimi intervalli; una pausa lunga ricomincia da capo.

const RESET_MS = 2000; // oltre questo, il colpo successivo è il primo di una nuova serie
const KEEP = 4; // intervalli usati per la media

export class TapTempo {
  constructor() {
    this.times = [];
  }

  /** Registra un colpo; restituisce il tempo in ms (media degli intervalli) o null al primo colpo. */
  tap(now = performance.now()) {
    if (this.times.length && now - this.times.at(-1) > RESET_MS) this.times = [];
    this.times.push(now);
    if (this.times.length > KEEP + 1) this.times.shift();
    if (this.times.length < 2) return null;
    return (this.times.at(-1) - this.times[0]) / (this.times.length - 1);
  }
}

export const bpm = ms => Math.round(60000 / ms);
