// Codifica/decodifica OSC 1.0 (sottoinsieme usato dai mixer X Air).

const pad4 = n => (n + 3) & ~3;

function encodeString(s) {
  const raw = Buffer.from(`${s}\0`, 'utf8');
  const out = Buffer.alloc(pad4(raw.length));
  raw.copy(out);
  return out;
}

function readString(buf, offset) {
  let end = buf.indexOf(0, offset);
  if (end < 0) end = buf.length;
  return [buf.toString('utf8', offset, end), offset + pad4(end - offset + 1)];
}

/** args: [{ type: 'f'|'i'|'s'|'b', value }] */
export function encode(address, args = []) {
  let tags = ',';
  const parts = [];
  for (const { type, value } of args) {
    switch (type) {
      case 'f': {
        const b = Buffer.alloc(4);
        b.writeFloatBE(Number(value));
        parts.push(b);
        break;
      }
      case 'i': {
        const b = Buffer.alloc(4);
        b.writeInt32BE(Math.round(Number(value)));
        parts.push(b);
        break;
      }
      case 's':
        parts.push(encodeString(String(value)));
        break;
      case 'b': {
        const data = Buffer.from(value);
        const b = Buffer.alloc(4 + pad4(data.length));
        b.writeInt32BE(data.length);
        data.copy(b, 4);
        parts.push(b);
        break;
      }
      default:
        throw new Error(`Tipo OSC non supportato: ${type}`);
    }
    tags += type;
  }
  return Buffer.concat([encodeString(address), encodeString(tags), ...parts]);
}

function decodeMessage(buf) {
  let [address, offset] = readString(buf, 0);
  const args = [];
  if (offset >= buf.length) return { address, args };
  let tags;
  [tags, offset] = readString(buf, offset);
  for (const type of tags.slice(1)) {
    switch (type) {
      case 'f': args.push({ type, value: buf.readFloatBE(offset) }); offset += 4; break;
      case 'i': args.push({ type, value: buf.readInt32BE(offset) }); offset += 4; break;
      case 's': {
        const [value, next] = readString(buf, offset);
        args.push({ type, value });
        offset = next;
        break;
      }
      case 'b': {
        const len = buf.readInt32BE(offset);
        args.push({ type, value: buf.subarray(offset + 4, offset + 4 + len) });
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

/** Restituisce sempre un array di messaggi (i bundle vengono appiattiti). */
export function decode(buf) {
  if (buf.subarray(0, 8).toString() !== '#bundle\0') return [decodeMessage(buf)];
  const out = [];
  let offset = 16; // "#bundle\0" + timetag
  while (offset + 4 <= buf.length) {
    const size = buf.readInt32BE(offset);
    out.push(...decode(buf.subarray(offset + 4, offset + 4 + size)));
    offset += 4 + size;
  }
  return out;
}
