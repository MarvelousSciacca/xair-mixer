// MIDI nelle app Android e iOS: le WebView non hanno Web MIDI, quindi i controller li legge il
// plugin nativo (MidiManager su Android, CoreMIDI su iPhone/iPad) e qui si rifà la stessa forma di
// navigator.requestMIDIAccess(): { inputs: Map(id → { name, onmidimessage }), onstatechange }.
// Così il resto (midi.js: impara, collegamenti) non sa da dove arrivano i messaggi.

/**
 * Un pacchetto può contenere più messaggi uno dopo l'altro, anche con "running status" (lo stato
 * ripetuto sottinteso): li si separa in messaggi da 1-3 byte. I messaggi di tempo reale (clock,
 * start/stop: 0xF8-0xFF) e i SysEx si scartano.
 */
export function splitMidi(bytes) {
  const out = [];
  let status = 0;
  let msg = null;
  let inSysex = false;
  const need = s => {
    const t = s & 0xf0;
    if (t === 0xc0 || t === 0xd0) return 1;
    if (t >= 0x80 && t <= 0xe0) return 2;
    return 0;
  };
  for (const b of bytes) {
    if (b >= 0xf8) continue; // tempo reale: può arrivare anche in mezzo a un messaggio
    if (b === 0xf0) { inSysex = true; status = 0; msg = null; continue; }
    if (b === 0xf7) { inSysex = false; continue; }
    if (b >= 0x80) {
      inSysex = false;
      status = b >= 0xf0 ? 0 : b; // messaggi di sistema comuni: ignorati e niente running status
      msg = status ? [status] : null;
      continue;
    }
    if (inSysex || !status) continue;
    if (!msg) msg = [status]; // running status
    msg.push(b);
    if (msg.length - 1 === need(status)) {
      out.push(Uint8Array.from(msg));
      msg = null;
    }
  }
  return out;
}

/** Accesso MIDI tramite il plugin nativo, con la stessa forma di Web MIDI. */
export async function nativeMidiAccess(plugin) {
  const access = { inputs: new Map(), onstatechange: null };
  const update = list => {
    const ids = new Set();
    for (const { id, name } of list ?? []) {
      const key = String(id);
      ids.add(key);
      if (!access.inputs.has(key)) access.inputs.set(key, { id: key, name: name || 'MIDI', onmidimessage: null });
      else access.inputs.get(key).name = name || 'MIDI';
    }
    for (const key of [...access.inputs.keys()]) if (!ids.has(key)) access.inputs.delete(key);
  };
  await plugin.addListener('midi', ev => {
    const input = access.inputs.get(String(ev.id));
    if (!input?.onmidimessage) return;
    const timeStamp = performance.now();
    for (const data of splitMidi(ev.data ?? [])) input.onmidimessage({ data, timeStamp });
  });
  await plugin.addListener('midiInputs', ev => {
    update(ev.inputs);
    access.onstatechange?.({});
  });
  const r = await plugin.midiStart();
  update(r?.inputs);
  return access;
}
