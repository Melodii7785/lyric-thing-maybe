/** Compact loudness envelope for music-reactive background motion. */
export interface EnergySegment {
  start: number;
  loudnessStart: number;
  loudnessMax: number;
  peakAt: number;
}

export interface EnergySection {
  start: number;
  duration: number;
  loudness: number;
}

export interface EnergyAnalysis {
  segments?: EnergySegment[];
  sections?: EnergySection[];
}

const MIN_RANGE_DB = 6;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

/** Maps a track's loudness envelope into a normalized 0..1 energy value. */
export class TrackMotion {
  private readonly starts: number[];
  private readonly values: number[];
  private readonly lowDb: number;
  private readonly highDb: number;
  private readonly isFlat: boolean;

  constructor(analysis: EnergyAnalysis) {
    const segments = [...(analysis.segments ?? [])]
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.loudnessStart))
      .sort((a, b) => a.start - b.start);

    if (segments.length) {
      this.starts = segments.map((s) => s.start);
      this.values = segments.map((s) => s.loudnessStart);
    } else {
      const sections = [...(analysis.sections ?? [])]
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.loudness))
        .sort((a, b) => a.start - b.start);
      this.starts = sections.map((s) => s.start);
      this.values = sections.map((s) => s.loudness);
    }

    const sorted = [...this.values].sort((a, b) => a - b);
    const floor = percentile(sorted, 0.1);
    const ceiling = percentile(sorted, 0.9);
    const dynamicRange = ceiling - floor;
    this.isFlat = dynamicRange < MIN_RANGE_DB;
    const range = Math.max(MIN_RANGE_DB, dynamicRange);
    this.lowDb = floor;
    this.highDb = floor + range;
  }

  /** Energy at a song-relative position in seconds. Returns neutral for empty data. */
  energyAt(positionSeconds: number): number {
    if (this.isFlat) return 0.35;
    if (!this.starts.length || !Number.isFinite(positionSeconds) || positionSeconds < this.starts[0]) return 0.35;
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.starts[mid] <= positionSeconds) lo = mid;
      else hi = mid - 1;
    }
    const db = this.values[lo];
    return Math.max(0, Math.min(1, (db - this.lowDb) / (this.highDb - this.lowDb)));
  }
}
