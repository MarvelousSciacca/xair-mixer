// Codifica/decodifica OSC per il browser e le app (stessa logica di server/osc.js, senza Buffer).
// I blob decodificati sono Uint8Array; in codifica si accettano Uint8Array o base64.

const pad4 = n => (n + 3) & ~3;
const utf8 = new TextEncoder();
const utf8d = new TextDecoder();

function stringBytes(s) {
  const raw = utf8.encode(s);
  const out = new Uint8Array(pad4(raw.length + 1));
  out.set(raw);
  return out;
}

const fromBase64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** args: [{ type: 'f'|'i'|'s'|'b', value }] -> Uint8Array */
export function encode(address, args = []) {
  let tags = ',';
  const parts = [];
  for (const { type, value } of args) {
    if (type === 'f' || type === 'i') {
      const b = new Uint8Array(4);
      const dv = new DataView(b.buffer);
      if (type === 'f') dv.setFloat32(0, Number(value));
      else dv.setInt32(0, Math.round(Number(value)));
      parts.push(b);
    } else if (type === 's') {
      parts.push(stringBytes(String(value)));
    } else if (type === 'b') {
      const data = value instanceof Uint8Array ? value : fromBase64(String(value));
      const b = new Uint8Array(4 + pad4(data.length));
      new DataView(b.buffer).setInt32(0, data.length);
      b.set(data, 4);
      parts.push(b);
    } else {
      throw new Error(`Tipo OSC non supportato: ${type}`);
    }
    tags += type;
  }
  const chunks = [stringBytes(address), stringBytes(tags), ...parts];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function readString(bytes, offset) {
  let end = bytes.indexOf(0, offset);
  if (end < 0) end = bytes.length;
  return [utf8d.decode(bytes.subarray(offset, end)), offset + pad4(end - offset + 1)];
}

function decodeMessage(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let [address, offset] = readString(bytes, 0);
  const args = [];
  if (offset >= bytes.length) return { address, args };
  let tags;
  [tags, offset] = readString(bytes, offset);
  for (const type of tags.slice(1)) {
    switch (type) {
      case 'f': args.push({ type, value: dv.getFloat32(offset) }); offset += 4; break;
      case 'i': args.push({ type, value: dv.getInt32(offset) }); offset += 4; break;
      case 's': {
        const [value, next] = readString(bytes, offset);
        args.push({ type, value });
        offset = next;
        break;
      }
      case 'b': {
        const len = dv.getInt32(offset);
        args.push({ type, value: bytes.slice(offset + 4, offset + 4 + len) });
        offset += 4 + pad4(len);
        break;
      }
      case 'T': args.push({ type: 'i', value: 1 }); break;
      case 'F': args.push({ type: 'i', value: 0 }); break;
      default: throw new Error(`Tipo OSC non supportato: ${type}`);
    }
  }
  return { address, args };
}

const BUNDLE = utf8.encode('#bundle\0');
const isBundle = bytes => bytes.length >= 8 && BUNDLE.every((c, i) => bytes[i] === c);

/** Restituisce sempre un array di messaggi (i bundle vengono appiattiti). */
export function decode(bytes) {
  if (!isBundle(bytes)) return [decodeMessage(bytes)];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let offset = 16; // "#bundle\0" + timetag
  while (offset + 4 <= bytes.length) {
    const size = dv.getInt32(offset);
    out.push(...decode(bytes.subarray(offset + 4, offset + 4 + size)));
    offset += 4 + size;
  }
  return out;
}

/** Uint8Array -> base64 (per il passaggio al codice nativo). */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export { fromBase64 };
