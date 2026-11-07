// Unwrap the containers MIDI files used to travel in, down to the Standard
// MIDI File inside. Pure and dependency-free; verify:melody tests it.
//
//   unwrapMidi(bytes, fileName?) → { bytes, steps: ["BinHex 4.0 (name.mid)", ...] }
//
// Handled, possibly nested:
//   • BinHex 4.0 (.hqx): the classic Mac text encoding. Decodes the 6-bit text,
//     undoes its run-length encoding, checks the header and data-fork CRCs,
//     and keeps the data fork (where a Mac MIDI file keeps its notes).
//   • RIFF MIDI (.rmi): a RIFF "RMID" wrapper around an SMF "data" chunk.
//   • A MacBinary-style header or other short prefix before "MThd".
// Recognised but not unpacked (a readable error): StuffIt archives (.sit),
// which use several compression schemes. Unpack them with a desktop tool first.

import { MidiError } from "./midi.js";

export const CONTAINER_LIMITS = { maxBytes: 2 * 1024 * 1024 }; // text-encoded files are ~1.4× bigger

const BINHEX_ALPHABET = "!\"#$%&'()*+,-012345689@ABCDEFGHIJKLMNPQRSTUVXYZ[`abcdefhijklmpqr";
const BINHEX_MARKER = "(This file must be converted with BinHex";

const ascii = (bytes, start, len) => String.fromCharCode(...bytes.subarray(start, start + len));
const startsWith = (bytes, text, at = 0) => bytes.length >= at + text.length && ascii(bytes, at, text.length) === text;

/** CRC-16/XMODEM (poly 0x1021, init 0), as BinHex uses it. */
export function crc16xmodem(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** True if the bytes look like BinHex 4.0 text. */
export function isBinHex(bytes) {
  const head = ascii(bytes, 0, Math.min(bytes.length, 4096));
  return head.includes(BINHEX_MARKER);
}

/**
 * Decode BinHex 4.0 text.
 * @returns {{name:string, type:string, creator:string, data:Uint8Array, resourceLength:number}}
 */
export function decodeBinHex(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  const markerAt = text.indexOf(BINHEX_MARKER);
  if (markerAt < 0) throw new MidiError("Not a BinHex file.");
  const open = text.indexOf(":", text.indexOf(")", markerAt));
  if (open < 0) throw new MidiError("The BinHex data is missing its opening ':'.");
  const close = text.indexOf(":", open + 1);
  if (close < 0) throw new MidiError("The BinHex data is cut off (no closing ':').");

  // 6-bit text → bytes (whitespace and line breaks are ignored).
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < BINHEX_ALPHABET.length; i++) lookup[BINHEX_ALPHABET.charCodeAt(i)] = i;
  const packed = [];
  let acc = 0, bits = 0;
  for (let i = open + 1; i < close; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13 || c === 32 || c === 9) continue;
    const v = c < 128 ? lookup[c] : -1;
    if (v < 0) throw new MidiError(`The BinHex data has an invalid character ("${text[i]}").`);
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; packed.push((acc >> bits) & 0xff); }
  }

  // Run-length decoding: 0x90 n repeats the previous byte (n−1 more times); 0x90 0x00 is a literal 0x90.
  const out = [];
  for (let i = 0; i < packed.length; i++) {
    const b = packed[i];
    if (b !== 0x90) { out.push(b); continue; }
    const n = packed[++i];
    if (n === undefined) break;
    if (n === 0) { out.push(0x90); continue; }
    const prev = out[out.length - 1];
    for (let k = 1; k < n; k++) out.push(prev);
  }
  const buf = Uint8Array.from(out);

  // Header: name length, name, version, type, creator, flags, data length, resource length, CRC.
  let p = 0;
  const need = (n) => { if (p + n > buf.length) throw new MidiError("The BinHex data ends too early (truncated file)."); };
  need(1);
  const nameLen = buf[p++];
  need(nameLen + 1 + 4 + 4 + 2 + 4 + 4 + 2);
  const name = ascii(buf, p, nameLen); p += nameLen;
  p += 1; // version
  const type = ascii(buf, p, 4); p += 4;
  const creator = ascii(buf, p, 4); p += 4;
  p += 2; // Finder flags
  const u32 = () => { const v = ((buf[p] << 24) >>> 0) + (buf[p + 1] << 16) + (buf[p + 2] << 8) + buf[p + 3]; p += 4; return v; };
  const dataLen = u32(), resLen = u32();
  const headerEnd = p;
  const headerCrc = (buf[p] << 8) | buf[p + 1]; p += 2;
  if (crc16xmodem(buf, 0, headerEnd) !== headerCrc) throw new MidiError("The BinHex header is corrupted (checksum mismatch).");
  need(dataLen + 2);
  const data = buf.slice(p, p + dataLen);
  const dataCrc = (buf[p + dataLen] << 8) | buf[p + dataLen + 1];
  if (crc16xmodem(data) !== dataCrc) throw new MidiError("The BinHex data is corrupted (checksum mismatch).");
  return { name, type, creator, data, resourceLength: resLen };
}

/** Peel containers until an "MThd" chunk is at offset 0. Throws MidiError if none is found. */
export function unwrapMidi(input, fileName = "") {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > CONTAINER_LIMITS.maxBytes) throw new MidiError(`The file is larger than ${CONTAINER_LIMITS.maxBytes / 1024 / 1024} MB.`);
  const steps = [];
  for (let depth = 0; depth < 4; depth++) {
    if (startsWith(bytes, "MThd")) return { bytes, steps };
    if (isBinHex(bytes)) {
      const hqx = decodeBinHex(bytes);
      steps.push(`BinHex 4.0${hqx.name ? ` (${hqx.name})` : ""}`);
      if (!hqx.data.length) {
        throw new MidiError(hqx.resourceLength
          ? "The BinHex file holds only a Mac resource fork, with no MIDI data."
          : "The BinHex file is empty.");
      }
      bytes = hqx.data;
      continue;
    }
    if (startsWith(bytes, "RIFF") && startsWith(bytes, "RMID", 8)) {
      let p = 12, found = null;
      while (p + 8 <= bytes.length) {
        const id = ascii(bytes, p, 4);
        const len = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
        if (id === "data") { found = bytes.slice(p + 8, p + 8 + len); break; }
        p += 8 + len + (len & 1);
      }
      if (!found) throw new MidiError("The RIFF MIDI file has no data chunk.");
      steps.push("RIFF MIDI");
      bytes = found;
      continue;
    }
    if (startsWith(bytes, "SIT!") || startsWith(bytes, "StuffIt") || startsWith(bytes, "rLau", 10) || startsWith(bytes, "SIT!", 65)) {
      throw new MidiError(`${steps.length ? "Inside the BinHex file is" : "This is"} a StuffIt archive, which can't be opened here. Unpack it first (for example with The Unarchiver or StuffIt Expander), then upload the .mid file inside.`);
    }
    // A short prefix before the MIDI header (e.g. a 128-byte MacBinary header).
    const window = ascii(bytes, 0, Math.min(bytes.length, 512));
    const at = window.indexOf("MThd");
    if (at > 0) { steps.push(at === 128 ? "MacBinary header" : `${at}-byte prefix`); bytes = bytes.slice(at); continue; }
    break;
  }
  throw new MidiError(steps.length
    ? `Unwrapped ${steps.join(" → ")}, but there's no MIDI file inside.`
    : /\.(hqx|sit|bin)$/i.test(fileName)
      ? "This file isn't a MIDI file or a recognised wrapper around one."
      : "This isn't a MIDI file (no MIDI header found).");
}
