// Minimal Standard MIDI File writer for tests (no dependency). Builds files
// byte by byte so each MIDI edge case can be exercised on purpose.
//   smf({ format, ppq | smpte: {fps, tpf}, tracks: [[ev, ...], ...] })
// where ev = [deltaTicks, ...bytes] (status included, or omitted for running status).
const vlq = (n) => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
export function smf({ format = 1, ppq = 480, smpte = null, tracks }) {
  const division = smpte ? (((256 - smpte.fps) & 0xff) << 8) | smpte.tpf : ppq;
  const bytes = [..."MThd"].map((c) => c.charCodeAt(0)).concat(u32(6), u16(format), u16(tracks.length), u16(division));
  for (const evs of tracks) {
    const body = [];
    for (const [dt, ...b] of evs) body.push(...vlq(dt), ...b);
    body.push(0, 0xff, 0x2f, 0); // end of track
    bytes.push(..."MTrk".split("").map((c) => c.charCodeAt(0)), ...u32(body.length), ...body);
  }
  return new Uint8Array(bytes);
}
export const tempo = (bpm) => { const us = Math.round(60e6 / bpm); return [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]; };
export const name = (s) => [0xff, 0x03, s.length, ...[...s].map((c) => c.charCodeAt(0))];
export const on = (ch, p, v = 100) => [0x90 | ch, p, v];
export const off = (ch, p) => [0x80 | ch, p, 0];
