/*
 * Music haptics: turns a song's Spotify audio analysis into the vibrations that play along with it.
 *
 * Ported from Spicy Lyrics Mobile (https://github.com/spicylyrics/mobile, AGPL-3.0):
 *   app/.../haptics/MusicHapticScore.kt and core/.../network/data/spotify/Rhythm.kt
 * The scoring logic and its tuned constants follow the original closely; what changed is the
 * language, and that the rhythm string is decoded with the browser's DecompressionStream.
 * lyric thing is AGPL-3.0-only as well, so the licenses line up.
 */

/** What a music haptic marks. Kick/Snare/Note follow the drums, Beat/Downbeat the steady beat, Accent/Drop the big moments. */
export type MusicPulse = 'kick' | 'snare' | 'note' | 'beat' | 'downbeat' | 'accent' | 'drop';

/** What the music haptics follow. */
export type MusicHapticsStyle = 'drums' | 'beat';

/**
 * One vibration in a song, at [atMs] into it, [strength] 0..1, with [roomMs] of quiet before the
 * next one (a long effect only fits where there is room for it). A 'drop' starts its swell at
 * [atMs] and lands DROP_RISE_MS later.
 */
export interface MusicHaptic {
  atMs: number;
  pulse: MusicPulse;
  strength: number;
  roomMs: number;
}

/** How long a 'drop' swell runs before it lands. */
export const DROP_RISE_MS = 500;

export interface AnalysisSection { start: number; duration: number; loudness: number; tempo: number }
export interface AnalysisBeat { start: number; duration: number; confidence: number }
export interface AnalysisSegment {
  start: number;
  loudnessStart: number;
  loudnessMax: number;
  /** Absolute time (seconds) of the segment's loudest point. */
  peakAt: number;
  brightness: number;
  timbre4: number;
  timbre9: number;
}
export interface AudioAnalysis {
  tempo: number;
  loudness: number;
  sections: AnalysisSection[];
  beats: AnalysisBeat[];
  /** When each bar starts: its first beat, the downbeat. */
  bars: number[];
  segments: AnalysisSegment[];
  rhythm: Rhythm | null;
}

// ---------------------------------------------------------------------------------------------
// Rhythm: where sounds start in a track, per frequency band (the analysis's `rhythmstring`).
// ---------------------------------------------------------------------------------------------

/** Onsets in the same moment across the bands: `bands` is a bit per band reached, low band first. */
export interface RhythmHit { at: number; bands: number; bandCount: number }

/** Onsets this close across bands are one hit, in seconds. */
const SAME_HIT = 0.025;

function popcount(n: number): number {
  let c = 0;
  while (n) { c += n & 1; n >>>= 1; }
  return c;
}

export class Rhythm {
  /** Every onset grouped into hits, in time order. */
  readonly hits: RhythmHit[];

  /** `bands`: eight lists (low to high) of onset times in seconds, each sorted. */
  constructor(readonly bands: Float32Array[]) {
    const onsets: Array<[number, number]> = [];
    bands.forEach((times, band) => times.forEach((t) => onsets.push([t, band])));
    onsets.sort((a, b) => a[0] - b[0]);
    const out: RhythmHit[] = [];
    let at = Number.NEGATIVE_INFINITY;
    let mask = 0;
    for (const [t, band] of onsets) {
      if (t - at < SAME_HIT) {
        mask |= 1 << band;
      } else {
        if (mask !== 0) out.push({ at, bands: mask, bandCount: popcount(mask) });
        at = t;
        mask = 1 << band;
      }
    }
    if (mask !== 0) out.push({ at, bands: mask, bandCount: popcount(mask) });
    this.hits = out;
  }

  /**
   * Decodes a `rhythmstring`: base64 (either alphabet) of zlib-packed text, "sample rate, step,
   * band count", then per band its onset count and the onsets as steps after the last.
   * Resolves to null when it doesn't read (or the browser can't inflate it).
   */
  static async parse(rhythmString: string): Promise<Rhythm | null> {
    try {
      if (typeof DecompressionStream === 'undefined') return null;
      const b64 = rhythmString.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const packed = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) packed[i] = bin.charCodeAt(i);
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));
      const text = await new Response(stream).text();
      const numbers = text.trim().split(' ').map(Number);
      if (numbers.some((n) => !Number.isFinite(n)) || numbers.length < 3) return null;
      const stepSeconds = numbers[1] / numbers[0];
      const bandCount = numbers[2];
      let i = 3;
      const bands: Float32Array[] = [];
      for (let b = 0; b < bandCount; b++) {
        const count = numbers[i++];
        const times = new Float32Array(count);
        let steps = 0;
        for (let k = 0; k < count; k++) { steps += numbers[i++]; times[k] = steps * stepSeconds; }
        bands.push(times);
      }
      return new Rhythm(bands);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------------------------

/** Beats this unsure are left out. */
const MIN_BEAT_CONFIDENCE = 0.05;
/** Pulses quieter than this (0..1) are left out. */
const MIN_STRENGTH = 0.12;
/** How far a bar may start from a beat and still make it a downbeat, in seconds. */
const DOWNBEAT_WINDOW = 0.06;
/** A segment starting this close to a beat is the sound on that beat, in seconds. */
const ON_BEAT = 0.07;
/** A section with hits reaching this many of the rhythm's bands surely has drums... */
const FULL_BANDS = 6;
/** ...and within one with drums, a hit reaching this many is a drum. */
const DRUM_BANDS = 5;
/** ...and one reaching this many, where there are no drums, a note. */
const NOTE_BANDS = 4;
/** A section with as many full-band hits as this share of its beats has drums (a backbeat alone is half)... */
const DRUM_SECTION_SHARE = 0.2;
/** ...and so does one with drum hits on this share of its beats, in a song with drums elsewhere, no more than DRUM_SECTION_QUIETER_DB quieter. */
const DRUM_HIT_SHARE = 0.3;
const DRUM_SECTION_QUIETER_DB = 3;
/** A section with full-band hits on fewer than this share of its downbeats has a low kick... */
const FULL_DOWNBEATS = 0.5;
/** ...taken from onsets in the lowest band this loud (0..1)... */
const LOW_KICK_LEVEL = 0.75;
/** ...that rise at least this many dB. */
const LOW_KICK_JUMP_DB = 8;
/** A full-band hit this close to a downbeat is on it, in seconds. */
const ON_DOWNBEAT = 0.05;
/** How much snarier than the hits around it (in track standard deviations) a snare sounds. */
const SNARE_CONTRAST = 0.3;
/** The hits this close either side are what a hit's sound is compared with, in seconds. */
const SNARE_WINDOW = 4;
/** A hit takes the segment starting up to this long after it as its sound, in seconds. */
const SOUND_LAG = 0.03;
/** Notes (in sections without drums) at least this far apart, in seconds. */
const NOTE_GAP = 0.15;
/** A bar's slots: sixteenths. */
const SLOTS = 16;
/** A hit this far (in slots) from a sixteenth is on it. */
const ON_SLOT = 0.3;
/** A section needs this many bars to have a groove. */
const GROOVE_MIN_BARS = 4;
/** A sixteenth hit in this share of a section's bars is part of its groove. */
const GROOVE_SHARE = 0.5;
/** The groove plays only where a sound reaching this many bands starts within GROOVE_SOUND_WINDOW (seconds). */
const GROOVE_SOUND_BANDS = 3;
const GROOVE_SOUND_WINDOW = 0.04;
/** A hit off the groove (a fill, a crash) still plays when this strong. */
const FILL_STRENGTH = 0.7;
/** A section this many dB louder than the one before comes in with an accent... */
const DROP_DB = 4;
/** ...and with a swell into it from this many. */
const RISE_DB = 6;
/** A segment whose peak is this many dB over its start is a big hit... */
const HIT_ATTACK_DB = 20;
/** ...when it also peaks this many dB over the track's average loudness. */
const HIT_OVER_TRACK_DB = 1;
/** Following the drums, a hit at least this loud (0..1)... */
const COMEBACK_LEVEL = 0.6;
/** ...after this long with nothing louder than QUIET_LEVEL is an accent, in seconds. */
const COMEBACK_PAUSE = 1;
const QUIET_LEVEL = 0.2;
/** Accents closer together than this blur into one, in seconds. */
const MIN_ACCENT_GAP = 3;
/** An accent takes the place of a pulse this close, in seconds. */
const ACCENT_SNAP = 0.12;
/** Pulses closer together than this blur on the motor; the weaker goes, in milliseconds. */
const MIN_GAP_MS = 90;

const ms = (seconds: number): number => Math.trunc(seconds * 1000);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const haptic = (atMs: number, pulse: MusicPulse, strength: number, roomMs = Number.POSITIVE_INFINITY): MusicHaptic =>
  ({ atMs, pulse, strength, roomMs });

/** How loud `dB` is, 0..1, against the track's average: 15 dB under it is 0, 3 dB over it is 1. */
export function level(dB: number, trackLoudness: number): number {
  return clamp((dB - (trackLoudness - 15)) / 18, 0, 1);
}

/** Index of the last element of `sorted` at or before `t`, or -1. */
function lastAtOrBefore(sorted: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= t) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at;
}

/** The analysis, sorted and measured once. */
class Song {
  readonly segments: AnalysisSegment[];
  readonly starts: number[];
  readonly beats: AnalysisBeat[];
  readonly bars: number[];
  readonly sectionStarts: number[];
  /**
   * How much each segment sounds like a snare rather than a kick, in track standard deviations
   * (timbre is only comparable within one song): brighter, higher on the fifth coefficient, lower
   * on the tenth.
   */
  readonly snareTone: number[];

  constructor(readonly a: AudioAnalysis) {
    this.segments = [...a.segments].sort((x, y) => x.start - y.start);
    this.starts = this.segments.map((s) => s.start);
    this.beats = a.beats.filter((b) => b.confidence >= MIN_BEAT_CONFIDENCE);
    this.bars = [...a.bars].sort((x, y) => x - y);
    this.sectionStarts = a.sections.map((s) => s.start);
    const tone = this.standardised((s) => s.brightness);
    const fifth = this.standardised((s) => s.timbre4);
    const tenth = this.standardised((s) => s.timbre9);
    for (let i = 0; i < tone.length; i++) tone[i] += fifth[i] - tenth[i];
    this.snareTone = tone;
  }

  level(i: number): number { return level(this.segments[i].loudnessMax, this.a.loudness); }
  jump(i: number): number { return this.segments[i].loudnessMax - this.segments[i].loudnessStart; }

  /** The time in `sorted` nearest `t`, if one is within `window`. */
  nearest(sorted: ArrayLike<number>, t: number, window: number): number | null {
    const i = lastAtOrBefore(sorted, t);
    const before = i >= 0 && t - sorted[i] <= window ? sorted[i] : null;
    const after = i + 1 < sorted.length && sorted[i + 1] - t <= window ? sorted[i + 1] : null;
    if (before === null) return after;
    if (after === null) return before;
    return Math.abs(after - t) < Math.abs(before - t) ? after : before;
  }

  /** Whether `sorted` has a time within `window` of `t`. */
  hasNear(sorted: ArrayLike<number>, t: number, window: number): boolean {
    const i = lastAtOrBefore(sorted, t + window);
    return i >= 0 && sorted[i] >= t - window;
  }

  /** The segment playing at `t`, or null before the first. */
  segmentAt(t: number): number | null {
    const i = lastAtOrBefore(this.starts, t);
    return i >= 0 ? i : null;
  }

  /** The loudest segment starting within ON_BEAT of `t`, or null. */
  soundAt(t: number): number | null {
    let i = lastAtOrBefore(this.starts, t + ON_BEAT);
    let best: number | null = null;
    while (i >= 0 && this.starts[i] >= t - ON_BEAT) {
      if (best === null || this.segments[i].loudnessMax > this.segments[best].loudnessMax) best = i;
      i--;
    }
    return best;
  }

  /** How loud it is at `t`: the sound on it, else the segment playing, else the section. */
  levelAt(t: number): number {
    const sound = this.soundAt(t);
    if (sound !== null) return this.level(sound);
    const i = lastAtOrBefore(this.starts, t);
    if (i >= 0) return this.level(i);
    const section = this.a.sections[this.sectionIndex(t)];
    return level(section?.loudness ?? this.a.loudness, this.a.loudness);
  }

  isDownbeat(t: number): boolean {
    const i = lastAtOrBefore(this.bars, t + DOWNBEAT_WINDOW);
    return i >= 0 && Math.abs(this.bars[i] - t) <= DOWNBEAT_WINDOW;
  }

  sectionIndex(t: number): number { return lastAtOrBefore(this.sectionStarts, t); }

  private standardised(value: (s: AnalysisSegment) => number): number[] {
    const n = this.segments.length;
    if (n === 0) return [];
    let sum = 0;
    for (const s of this.segments) sum += value(s);
    const mean = sum / n;
    let sq = 0;
    for (const s of this.segments) { const d = value(s) - mean; sq += d * d; }
    const sd = Math.sqrt(sq / n);
    const safe = sd > 1e-6 ? sd : 1;
    return this.segments.map((s) => (value(s) - mean) / safe);
  }
}

/**
 * Builds the song's haptic score.
 *
 * 'drums' feels what is played, from the song's Rhythm: a snare, a clap or an acoustic kick starts
 * a sound in nearly every frequency band at once, where a bass note or a hi-hat starts one in a band
 * or two, so hits reaching most bands are drums, and the more bands the harder. Each is a kick or a
 * snare by its timbre against the hits around it. Sections without full-band drum hits follow the
 * notes instead, lightly. Each drum section is then played as its groove (what is hit on a sixteenth
 * in most of its bars plays in every bar), so a repeating pattern doesn't flicker. A song with no
 * rhythm in its analysis gets the steady beat.
 *
 * 'beat' is a steady pulse: every beat, firmer on each bar's first.
 *
 * Both mark drops (a section that comes in much louder than the one before) and big hits, and both
 * follow the loudness: quiet parts are faint, silence still.
 */
export function buildMusicHapticScore(analysis: AudioAnalysis, style: MusicHapticsStyle = 'drums'): MusicHaptic[] {
  const song = new Song(analysis);
  const pulses = style === 'drums' ? drums(song) : steadyBeat(song);
  return finish(withAccents(pulses, song, style));
}

// Drums

function drums(song: Song): MusicHaptic[] {
  const rhythm = song.a.rhythm;
  if (!rhythm) return steadyBeat(song);
  let out: MusicHaptic[] = [];
  const sections = song.a.sections;
  const fullHits = rhythm.hits.filter((h) => h.bandCount >= DRUM_BANDS);
  const count = (hits: RhythmHit[], from: number, to: number, bands: number): number =>
    hits.reduce((n, h) => n + (h.at >= from && h.at < to && h.bandCount >= bands ? 1 : 0), 0);
  const fullTimes = fullHits.map((h) => h.at);
  // Sections whose kick only reaches the lowest band: their downbeats aren't full-band hits.
  const lowKickSections = sections.map((section) => {
    const downbeats = song.a.bars.filter((b) => b >= section.start && b < section.start + section.duration);
    return downbeats.length > 0 &&
      downbeats.filter((b) => song.hasNear(fullTimes, b, ON_DOWNBEAT)).length < FULL_DOWNBEATS * downbeats.length;
  });
  const inSection = (flags: boolean[], t: number): boolean => {
    const s = song.sectionIndex(t);
    // Before the first section (or with none), go with the most of the song.
    return s >= 0 ? flags[s] : flags.filter(Boolean).length * 2 >= flags.length;
  };
  const beatsIn = sections.map((section) =>
    song.beats.filter((b) => b.start >= section.start && b.start < section.start + section.duration).length);
  const sureDrums = sections.map((section, i) =>
    beatsIn[i] > 0 && count(fullHits, section.start, section.start + section.duration, FULL_BANDS) >= DRUM_SECTION_SHARE * beatsIn[i]);
  const sureLoudness = sections.filter((_, i) => sureDrums[i]).map((s) => s.loudness);
  const drumLoudness = sureLoudness.length ? sureLoudness.reduce((a, b) => a + b, 0) / sureLoudness.length : Number.NaN;
  const drumSections = sections.map((section, i) =>
    sureDrums[i] || (
      sureDrums.some(Boolean) && beatsIn[i] > 0 && section.loudness >= drumLoudness - DRUM_SECTION_QUIETER_DB &&
      count(fullHits, section.start, section.start + section.duration, DRUM_BANDS) >= DRUM_HIT_SHARE * beatsIn[i]
    ));
  const drumsAt = (t: number): boolean => inSection(drumSections, t);
  const lowKickAt = (t: number): boolean => drumsAt(t) && inSection(lowKickSections, t);
  const lowKicks = rhythm.hits.filter((hit) => {
    if ((hit.bands & 1) === 0 || hit.bandCount >= DRUM_BANDS || !lowKickAt(hit.at)) return false;
    const seg = song.segmentAt(hit.at + SOUND_LAG);
    return seg !== null && song.level(seg) >= LOW_KICK_LEVEL && song.jump(seg) >= LOW_KICK_JUMP_DB;
  });

  const drumHits = [...fullHits, ...lowKicks].sort((a, b) => a.at - b.at);
  const sounds = drumHits.map((h) => song.segmentAt(h.at + SOUND_LAG));
  drumHits.forEach((hit, h) => {
    if (!drumsAt(hit.at)) return;
    const seg = sounds[h];
    if (seg === null) return;
    if (hit.bandCount < DRUM_BANDS) {
      out.push(drum(song, hit.at, 'kick', song.level(seg) * 0.8));
      return;
    }
    // The fewest bands a drum reaches is a light hit, every band a full one.
    const fullness = clamp((hit.bandCount - DRUM_BANDS + 1) / (rhythm.bands.length - DRUM_BANDS + 1), 0, 1);
    const snare = isSnare(song, drumHits, sounds, h);
    out.push(drum(song, hit.at, snare ? 'snare' : 'kick', song.level(seg) * (0.45 + 0.55 * fullness)));
  });
  const soundTimes = rhythm.hits.filter((h) => h.bandCount >= GROOVE_SOUND_BANDS).map((h) => h.at);
  out = grooves(out, song, soundTimes, drumSections).filter((p) => p.strength >= MIN_STRENGTH);

  // No drums: a light touch on each clear note.
  let lastNote = Number.NEGATIVE_INFINITY;
  for (const hit of rhythm.hits) {
    if (hit.bandCount < NOTE_BANDS || hit.at - lastNote < NOTE_GAP || drumsAt(hit.at)) continue;
    const seg = song.segmentAt(hit.at + SOUND_LAG);
    if (seg === null) continue;
    const lvl = song.level(seg);
    if (lvl < 0.25) continue;
    out.push(haptic(ms(hit.at), 'note', 0.2 + 0.4 * lvl));
    lastNote = hit.at;
  }
  return out;
}

/**
 * `pulses` with each drum section's played as its groove. Its bars are laid on sixteenths; a
 * sixteenth hit in GROOVE_SHARE of them or more is the groove's, and plays in every bar, as the
 * pulse it is most often and at its median strength, at the hit if the bar has one there, else at
 * the sound starting nearest it in `sounds` (none: a break, and nothing plays). Hits off the groove
 * stay only as strong as a fill. Sections too short for a groove keep their hits.
 */
function grooves(pulses: MusicHaptic[], song: Song, sounds: number[], drumSections: boolean[]): MusicHaptic[] {
  const bars = [...song.a.bars].sort((a, b) => a - b);
  const out: MusicHaptic[] = [];
  const replaced = new Set<MusicHaptic>();
  song.a.sections.forEach((section, s) => {
    if (!drumSections[s]) return;
    const end = section.start + section.duration;
    const inSection: number[] = [];
    for (let i = 0; i < bars.length; i++) {
      if (i + 1 < bars.length && bars[i] >= section.start - 0.05 && bars[i] < end - 0.05) inSection.push(i);
    }
    if (inSection.length < GROOVE_MIN_BARS) return;
    // Each bar's pulse on each sixteenth, the strongest where two land on one.
    const grid = inSection.map((b) => {
      const start = bars[b];
      const length = bars[b + 1] - start;
      const slots: Array<MusicHaptic | null> = new Array<MusicHaptic | null>(SLOTS).fill(null);
      for (const p of pulses) {
        if (p.pulse !== 'kick' && p.pulse !== 'snare') continue;
        const at = (p.atMs / 1000 - start) / length * SLOTS;
        if (at < -0.5 || at >= SLOTS - 0.5) continue;
        replaced.add(p);
        const slot = Math.round(at);
        if (Math.abs(at - slot) > ON_SLOT) {
          if (p.strength >= FILL_STRENGTH) out.push(p);
          continue;
        }
        const held = slots[slot];
        if (held === null || held.strength < p.strength) slots[slot] = p;
      }
      return slots;
    });
    for (let slot = 0; slot < SLOTS; slot++) {
      const hits = grid.map((slots) => slots[slot]).filter((h): h is MusicHaptic => h !== null);
      if (hits.length < GROOVE_SHARE * grid.length) {
        hits.filter((h) => h.strength >= FILL_STRENGTH).forEach((h) => out.push(h));
        continue;
      }
      const pulse: MusicPulse = hits.filter((h) => h.pulse === 'snare').length * 2 > hits.length ? 'snare' : 'kick';
      const strength = hits.map((h) => h.strength).sort((a, b) => a - b)[Math.floor(hits.length / 2)];
      grid.forEach((slots, i) => {
        const here = slots[slot];
        let at: number | null = here ? here.atMs : null;
        if (at === null) {
          const b = inSection[i];
          const t = bars[b] + (bars[b + 1] - bars[b]) * slot / SLOTS;
          const n = song.nearest(sounds, t, GROOVE_SOUND_WINDOW);
          at = n === null ? null : ms(n);
        }
        if (at === null) return;
        out.push(haptic(at, pulse, strength));
      });
    }
  });
  return pulses.filter((p) => !replaced.has(p)).concat(out);
}

/** A drum hit at `at`; a kick on a downbeat lands a little firmer. */
function drum(song: Song, at: number, pulse: MusicPulse, strength: number): MusicHaptic {
  const firmer = pulse === 'kick' && song.isDownbeat(at) ? strength * 1.15 : strength;
  return haptic(ms(at), pulse, Math.min(firmer, 1));
}

/** Whether drum hit `h` sounds snarier than the median of the hits around it. */
function isSnare(song: Song, hits: RhythmHit[], sounds: Array<number | null>, h: number): boolean {
  const own = sounds[h];
  if (own === null) return false;
  const tone = song.snareTone[own];
  const around: number[] = [];
  let i = h - 1;
  while (i >= 0 && hits[h].at - hits[i].at <= SNARE_WINDOW) {
    const s = sounds[i];
    if (s !== null) around.push(song.snareTone[s]);
    i--;
  }
  i = h + 1;
  while (i < hits.length && hits[i].at - hits[h].at <= SNARE_WINDOW) {
    const s = sounds[i];
    if (s !== null) around.push(song.snareTone[s]);
    i++;
  }
  if (around.length < 3) return false;
  around.sort((a, b) => a - b);
  const mid = Math.floor(around.length / 2);
  const median = around.length % 2 === 1 ? around[mid] : (around[mid - 1] + around[mid]) / 2;
  return tone - median > SNARE_CONTRAST;
}

// Steady beat

function steadyBeat(song: Song): MusicHaptic[] {
  const out: MusicHaptic[] = [];
  for (const beat of song.beats) {
    const lvl = song.levelAt(beat.start);
    if (lvl < MIN_STRENGTH) continue;
    const sure = 0.7 + 0.3 * clamp(beat.confidence, 0, 1);
    out.push(song.isDownbeat(beat.start)
      ? haptic(ms(beat.start), 'downbeat', (0.45 + 0.55 * lvl) * sure)
      : haptic(ms(beat.start), 'beat', (0.25 + 0.45 * lvl) * sure));
  }
  return out;
}

// Accents and drops

interface Accent { at: number; strength: number; rise: boolean }

function withAccents(input: MusicHaptic[], song: Song, style: MusicHapticsStyle): MusicHaptic[] {
  let pulses = input;
  const candidates: Accent[] = [];
  const sections = song.a.sections;
  for (let i = 0; i + 1 < sections.length; i++) {
    const jump = sections[i + 1].loudness - sections[i].loudness;
    if (jump >= DROP_DB) candidates.push({ at: sections[i + 1].start, strength: Math.min(0.7 + jump / 20, 1), rise: jump >= RISE_DB });
  }
  let quietSince = 0;
  song.segments.forEach((seg, i) => {
    const attack = seg.loudnessMax - seg.loudnessStart;
    const bigHit = attack >= HIT_ATTACK_DB && seg.loudnessMax >= song.a.loudness + HIT_OVER_TRACK_DB;
    // Following the drums, the kicks already carry the hits; only the music crashing back in after a pause stands out.
    const comeback = song.level(i) >= COMEBACK_LEVEL && seg.start - quietSince >= COMEBACK_PAUSE;
    if (style === 'drums' ? comeback : bigHit) {
      candidates.push({ at: seg.peakAt, strength: clamp(0.6 + (attack - HIT_ATTACK_DB) / 40, 0.6, 0.9), rise: false });
    }
    if (song.level(i) >= QUIET_LEVEL) quietSince = seg.start + 0.001;
  });
  // Strongest first, so a drop wins over a hit beside it.
  const kept: Accent[] = [];
  for (const c of [...candidates].sort((a, b) => b.strength - a.strength)) {
    if (kept.every((k) => Math.abs(k.at - c.at) >= MIN_ACCENT_GAP)) kept.push(c);
  }
  for (const accent of kept) {
    // It lands on the pulse nearest it, if one is close.
    const target = ms(accent.at);
    let near: MusicHaptic | null = null;
    for (const p of pulses) {
      const d = Math.abs(p.atMs - target);
      if (d <= ms(ACCENT_SNAP) && (near === null || d < Math.abs(near.atMs - target))) near = p;
    }
    const at = near ? near.atMs : target;
    if (accent.rise) {
      // Nothing may cut the swell short.
      pulses = pulses.filter((p) => !(p.atMs >= at - DROP_RISE_MS && p.atMs <= at + MIN_GAP_MS));
      pulses.push(haptic(at - DROP_RISE_MS, 'drop', accent.strength));
    } else {
      if (near) { const gone = near; pulses = pulses.filter((p) => p !== gone); }
      pulses.push(haptic(at, 'accent', accent.strength));
    }
  }
  return pulses;
}

/** In time order, too-close pulses thinned (the stronger stays), each told how much room it has. */
function finish(input: MusicHaptic[]): MusicHaptic[] {
  const pulses = [...input].sort((a, b) => a.atMs - b.atMs);
  const thinned: MusicHaptic[] = [];
  for (const p of pulses) {
    const last = thinned[thinned.length - 1];
    // A drop's swell keeps its place; what follows it too closely goes.
    const lastEnd = last ? (last.pulse === 'drop' ? last.atMs + DROP_RISE_MS : last.atMs) : 0;
    if (!last || p.atMs - lastEnd >= MIN_GAP_MS) thinned.push(p);
    else if (last.pulse !== 'drop' && p.pulse !== 'drop' && p.strength > last.strength) thinned[thinned.length - 1] = p;
    else if (p.pulse === 'drop') thinned[thinned.length - 1] = p;
  }
  return thinned.map((p, i) => {
    const next = thinned[i + 1];
    return haptic(p.atMs, p.pulse, p.strength, next ? next.atMs - p.atMs : Number.POSITIVE_INFINITY);
  });
}
