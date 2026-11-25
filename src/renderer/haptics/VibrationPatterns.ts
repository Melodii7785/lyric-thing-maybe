/*
 * Turns a music pulse into a `navigator.vibrate` pattern.
 *
 * Spicy Lyrics Mobile plays each pulse with Android's amplitude control and built-in effects
 * (click, thud, quick fall, slow rise). The Web Vibration API has neither: a pattern is only
 * alternating on/off durations in milliseconds, on at full power. So strength becomes how long the
 * motor is on, and each kind of pulse gets its own shape:
 *   kick     a firm buzz, with a second softer one behind it where there is room (a thud's body)
 *   snare    a crisp short tick with a quick rattle after it
 *   note     a very short, light tick
 *   beat     a short buzz; downbeat: a longer one
 *   accent   a tick into a long buzz
 *   drop     a swell: the motor is on for a growing share of each 50 ms, then a long thud
 *
 * Durations are tuned by feel and phone motors differ (many ignore anything under ~8 ms), so every
 * number here is a knob in one place.
 */
import type { MusicPulse } from './MusicHapticScore.ts';

/** The lowest scale a pulse plays at: below it a short buzz fades out of feel. */
const FELT = 0.35;
/** A kick gets a body only this strong and with this much quiet after it (ms). */
const KICK_BODY_STRENGTH = 0.6;
const KICK_BODY_ROOM_MS = 350;
/** A snare rattles only with this much quiet after it (ms). */
const SNARE_RATTLE_ROOM_MS = 120;
/** Length and slice size of a drop's swell. */
const DROP_SLICES = 10;
const DROP_SLICE_MS = 50;

const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

/**
 * The vibrate pattern for one pulse. `strength` is 0..1 (already multiplied by any user scale);
 * `roomMs` is the quiet before the next pulse, so a long effect only plays where it fits.
 */
export function pulseToPattern(pulse: MusicPulse, strength: number, roomMs: number): number[] {
  const s = FELT + (1 - FELT) * Math.min(1, Math.max(0, strength));
  switch (pulse) {
    case 'kick': {
      const on = lerp(16, 42, s);
      return roomMs >= KICK_BODY_ROOM_MS && strength >= KICK_BODY_STRENGTH ? [on, 14, lerp(18, 34, s)] : [on];
    }
    case 'snare': {
      const on = lerp(7, 14, s);
      return roomMs >= SNARE_RATTLE_ROOM_MS ? [on, 16, lerp(4, 7, s), 16, lerp(3, 5, s)] : [on];
    }
    case 'note':
      return [lerp(5, 10, s)];
    case 'beat':
      return [lerp(10, 24, s)];
    case 'downbeat':
      return [lerp(16, 34, s)];
    case 'accent':
      return [lerp(14, 26, s), 18, lerp(24, 44, s)];
    case 'drop': {
      const out: number[] = [];
      for (let i = 0; i < DROP_SLICES; i++) {
        const duty = (0.12 + 0.7 * (i / (DROP_SLICES - 1))) * (0.6 + 0.4 * s);
        const on = Math.max(2, Math.round(DROP_SLICE_MS * duty));
        out.push(on, DROP_SLICE_MS - on);
      }
      out.push(lerp(30, 50, s));
      return out;
    }
  }
}
