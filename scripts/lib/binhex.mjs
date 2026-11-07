// Minimal BinHex 4.0 encoder for tests (data fork only). Run-length encodes
// runs of 3+ identical bytes and escapes 0x90, so the decoder's RLE path and
// CRC checks are exercised, not just the 6-bit text layer.
import { crc16xmodem } from "../../src/melodies/container.js";
const ALPHA = "!\"#$%&'()*+,-012345689@ABCDEFGHIJKLMNPQRSTUVXYZ[`abcdefhijklmpqr";
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const withCrc = (arr) => { const c = crc16xmodem(Uint8Array.from(arr)); return [...arr, c >> 8, c & 255]; };
export function binhex(data, { name = "file.mid", type = "Midi", creator = "    " } = {}) {
  const header = [name.length, ...[...name].map((c) => c.charCodeAt(0)), 0,
    ...[...type].map((c) => c.charCodeAt(0)), ...[...creator].map((c) => c.charCodeAt(0)), 0, 0, ...be32(data.length), ...be32(0)];
  const raw = [...withCrc(header), ...withCrc([...data]), 0, 0]; // empty resource fork: CRC 0
  const rle = [];
  for (let i = 0; i < raw.length;) {
    let j = i; while (j < raw.length && raw[j] === raw[i] && j - i < 255) j++;
    const run = j - i, b = raw[i];
    rle.push(b); if (b === 0x90) rle.push(0x00);
    if (run >= 3) { rle.push(0x90, run); i = j; } else { i += 1; }
  }
  let bits = 0, acc = 0, out = "";
  for (const b of rle) { acc = (acc << 8) | b; bits += 8; while (bits >= 6) { bits -= 6; out += ALPHA[(acc >> bits) & 63]; } }
  if (bits) out += ALPHA[(acc << (6 - bits)) & 63];
  const lines = out.match(/.{1,64}/g).join("\n");
  return new TextEncoder().encode(`(This file must be converted with BinHex 4.0)\n:${lines}:\n`);
}
