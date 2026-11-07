// Standard MIDI File → melody. Pure and dependency-free (the project builds on
// raw browser APIs only), so verify:melody tests it without a browser.
//
//   parseMidi(bytes)                 → { format, ppq, smpte, tracks, tempos }
//   midiTrackOptions(parsed)         → pitched, non-percussion tracks, busiest first
//   midiToMelody(parsed, opts)       → { name, bpm, notes:[{midi, beats}] } + report
//
// The result goes through normalizeMelody() (normalize.js) like any imported
// melody, which fits it into the app's pitch range.
//
// Decisions (MELODY-FINDINGS §11):
//   • one voice: the busiest pitched track unless the caller picks one, or
//     `track: "all"` merges every pitched track. Channel 10 (percussion) is
//     never a voice.
//   • overlaps → a single line: when several notes start on the same tick the
//     highest wins; a new onset always ends the note before it.
//   • timing kept as written (no quantizing). Tempo changes are honoured: each
//     note's real duration in seconds is re-expressed in beats of the first
//     tempo, so the tune plays at its true speed. Gaps shorter than 1/64 beat
//     are absorbed into the previous note (MIDI files rarely butt notes exactly).

export const MIDI_LIMITS = { maxBytes: 1024 * 1024 };
const PERCUSSION_CHANNEL = 9; // MIDI channel 10, zero-based
const DEFAULT_US_PER_QUARTER = 500000; // 120 bpm, the MIDI default

class MidiError extends Error {}

/** Parse a Standard MIDI File (format 0, 1 or 2). Throws MidiError with a readable message. */
export function parseMidi(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MIDI_LIMITS.maxBytes) throw new MidiError(`The file is larger than ${MIDI_LIMITS.maxBytes / 1024} KB.`);
  let pos = 0;
  const need = (n) => { if (pos + n > bytes.length) throw new MidiError("The file ends unexpectedly (truncated or not a MIDI file)."); };
  const u8 = () => { need(1); return bytes[pos++]; };
  const u16 = () => { need(2); const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; };
  const u32 = () => { need(4); const v = ((bytes[pos] << 24) >>> 0) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3]; pos += 4; return v; };
  const tag = () => { need(4); const t = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]); pos += 4; return t; };
  const vlq = () => { let v = 0; for (let i = 0; i < 4; i++) { const b = u8(); v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v; } throw new MidiError("Malformed timing data in the file."); };

  if (bytes.length < 14 || tag() !== "MThd") throw new MidiError("This isn't a MIDI file (no MIDI header found).");
  const hdrLen = u32();
  const format = u16(), nTracks = u16(), division = u16();
  pos += Math.max(0, hdrLen - 6);
  const smpte = (division & 0x8000) !== 0;
  // SMPTE timing (rare): ticks are fractions of a second, not of a beat. Convert
  // to an equivalent PPQ at the default tempo so the rest of the code is shared.
  let ppq;
  if (smpte) {
    const fps = 256 - (division >> 8); // stored as a negative byte
    const tpf = division & 0xff;
    ppq = (fps === 29 ? 29.97 : fps) * tpf * (DEFAULT_US_PER_QUARTER / 1e6);
  } else {
    ppq = division;
  }
  if (!ppq) throw new MidiError("The file's timing division is zero.");

  const tracks = [];
  const tempos = [];
  let formatTwoOffset = 0; // format 2: tracks are independent sequences, played one after another
  for (let t = 0; t < nTracks && pos < bytes.length; t++) {
    let id;
    try { id = tag(); } catch { break; }
    const len = u32();
    const end = Math.min(bytes.length, pos + len);
    if (id !== "MTrk") { pos = end; t--; continue; } // skip unknown chunks
    const track = { index: tracks.length, name: "", notes: [], channels: new Set() };
    const open = new Map(); // `${ch}:${pitch}` → stack of {startTick, vel}
    let tick = 0, status = 0, lastTick = 0;
    while (pos < end) {
      tick += vlq();
      let b = u8();
      if (b === 0xff) { // meta
        const type = u8(); const mlen = vlq(); need(mlen);
        if (type === 0x51 && mlen === 3) {
          const us = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
          if (us > 0) tempos.push({ tick: tick + formatTwoOffset, us });
        } else if (type === 0x03 && !track.name) {
          track.name = new TextDecoder("latin1").decode(bytes.subarray(pos, pos + mlen)).trim();
        }
        pos += mlen;
        if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { const slen = vlq(); need(slen); pos += slen; continue; } // sysex
      if (b & 0x80) { status = b; } else { if (!status) throw new MidiError("Malformed event data in the file."); pos--; b = status; } // running status
      const type = status & 0xf0, ch = status & 0x0f;
      if (type === 0x80 || type === 0x90) {
        const pitch = u8() & 0x7f, vel = u8() & 0x7f;
        const key = `${ch}:${pitch}`;
        if (type === 0x90 && vel > 0) {
          if (!open.has(key)) open.set(key, []);
          open.get(key).push({ startTick: tick, vel });
        } else {
          const stack = open.get(key);
          const on = stack && stack.shift();
          if (on && tick > on.startTick) {
            track.notes.push({ pitch, channel: ch, vel: on.vel, startTick: on.startTick + formatTwoOffset, endTick: tick + formatTwoOffset });
            track.channels.add(ch);
          }
        }
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) { u8(); u8(); }
      else if (type === 0xc0 || type === 0xd0) { u8(); }
      lastTick = tick;
    }
    // Notes never switched off end at the track's last event.
    for (const [key, stack] of open) {
      const [ch, pitch] = key.split(":").map(Number);
      for (const on of stack) {
        if (lastTick > on.startTick) {
          track.notes.push({ pitch, channel: ch, vel: on.vel, startTick: on.startTick + formatTwoOffset, endTick: lastTick + formatTwoOffset });
          track.channels.add(ch);
        }
      }
    }
    track.notes.sort((a, b) => a.startTick - b.startTick || b.pitch - a.pitch);
    if (format === 2) formatTwoOffset += lastTick;
    pos = end;
    tracks.push(track);
  }
  if (!tracks.length) throw new MidiError("The file has no tracks.");
  tempos.sort((a, b) => a.tick - b.tick);
  return { format, ppq, smpte, tracks, tempos };
}

const isPercussion = (n) => n.channel === PERCUSSION_CHANNEL;

/** Tracks that can carry a melody (pitched notes outside channel 10), busiest first. */
export function midiTrackOptions(parsed) {
  return parsed.tracks
    .map((t) => ({ index: t.index, name: t.name || `Track ${t.index + 1}`, count: t.notes.filter((n) => !isPercussion(n)).length }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index);
}

/** Seconds at a tick, through the tempo map. */
function tickToSeconds(tick, ppq, tempos) {
  let secs = 0, lastTick = 0, us = DEFAULT_US_PER_QUARTER;
  for (const t of tempos) {
    if (t.tick >= tick) break;
    secs += ((t.tick - lastTick) / ppq) * (us / 1e6);
    lastTick = t.tick; us = t.us;
  }
  return secs + ((tick - lastTick) / ppq) * (us / 1e6);
}

/**
 * One playable voice from a parsed file.
 * @param {object} parsed  parseMidi() output
 * @param {{track?: number|"all", name?: string}} [opts]  track index (default: busiest)
 * @returns {{melody: {name, bpm, notes}, report: object}}  throws MidiError if no voice
 */
export function midiToMelody(parsed, opts = {}) {
  const options = midiTrackOptions(parsed);
  if (!options.length) {
    const anyNotes = parsed.tracks.some((t) => t.notes.length);
    throw new MidiError(anyNotes ? "The file only has percussion (channel 10), which has no melody." : "The file has no notes.");
  }
  let chosen;
  if (opts.track === "all") chosen = "all";
  else chosen = options.some((o) => o.index === opts.track) ? opts.track : options[0].index;

  const source = chosen === "all"
    ? parsed.tracks.flatMap((t) => t.notes)
    : parsed.tracks[chosen].notes;
  const pitched = source.filter((n) => !isPercussion(n)).sort((a, b) => a.startTick - b.startTick || b.pitch - a.pitch);

  // Single line: highest note per onset; each onset ends the previous note.
  const line = [];
  let dropped = 0, cut = 0;
  for (const n of pitched) {
    const prev = line[line.length - 1];
    if (prev && n.startTick === prev.startTick) { dropped++; continue; } // lower note of a chord
    if (prev && n.startTick < prev.endTick) { prev.endTick = n.startTick; cut++; }
    line.push({ ...n });
  }

  // Tempo: the first tempo sets the bpm; real seconds are re-expressed in its beats.
  const firstUs = parsed.tempos.length ? parsed.tempos[0].us : DEFAULT_US_PER_QUARTER;
  // Exact beats of the first tempo (not of a rounded bpm, which would put
  // 1e-6-beat errors on every note: MIDI stores 90 bpm as 666,667 µs).
  const bpm = 60e6 / firstUs;
  const secToBeats = (s) => s * 1e6 / firstUs;
  const tempoChanges = new Set(parsed.tempos.map((t) => t.us)).size > 1;
  const tempos = parsed.smpte ? [] : parsed.tempos; // SMPTE ppq was derived at the default tempo

  const GAP_EPS = 1 / 64; // beats
  const notes = [];
  let cursor = line.length ? tickToSeconds(line[0].startTick, parsed.ppq, tempos) : 0;
  for (const n of line) {
    const start = tickToSeconds(n.startTick, parsed.ppq, tempos);
    const end = tickToSeconds(n.endTick, parsed.ppq, tempos);
    const gap = secToBeats(start - cursor);
    if (gap > GAP_EPS) notes.push({ midi: null, beats: gap });
    else if (gap > 0 && notes.length) notes[notes.length - 1].beats += gap;
    notes.push({ midi: n.pitch, beats: secToBeats(end - start) });
    cursor = end;
  }
  // Tidy float noise from the tempo arithmetic (1e-9 beats is inaudible).
  for (const n of notes) n.beats = Math.round(n.beats * 1e6) / 1e6;

  const trackName = chosen === "all" ? "" : parsed.tracks[chosen].name;
  const name = opts.name || trackName || "Imported MIDI";
  return {
    melody: { name, bpm, notes },
    report: {
      track: chosen, trackName: chosen === "all" ? "All tracks" : (trackName || `Track ${chosen + 1}`),
      tracksWithNotes: options.length, chordNotesDropped: dropped, overlapsCut: cut, tempoChanges,
      smpte: parsed.smpte,
    },
  };
}

export { MidiError };
