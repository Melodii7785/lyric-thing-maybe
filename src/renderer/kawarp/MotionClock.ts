/** Smooth music energy into Kawarp time-rate and scale controls. */
export const MOTION_TUNING = {
  neutralEnergy: 0.35,
  quietRate: 0.66,
  loudRate: 2.76,
  pausedRate: 0.1,
  unanalyzedRate: 1.0,
  intensity: 1.5,
  scalePerEnergy: 0.025,
  attackSeconds: 1.1,
  releaseSeconds: 2.8,
  energyLeadSeconds: 0.6,
  playbackEaseSeconds: 0.6,
  analysisEaseSeconds: 0.8,
  maxFrameStepSeconds: 0.05,
} as const;

export interface MotionFrame {
  time: number;
  energy: number;
  rate: number;
  scale: number;
}

export class MotionClock {
  time = 0;
  energy: number = MOTION_TUNING.neutralEnergy;
  rate: number = MOTION_TUNING.unanalyzedRate * MOTION_TUNING.intensity;
  scale: number = 1;
  private playbackBlend = 0;
  private analysisBlend = 0;

  seed(timeSeconds: number): void {
    if (Number.isFinite(timeSeconds)) this.time = Math.max(0, timeSeconds);
  }

  step(deltaSeconds: number, positionSeconds: number, playing: boolean, track: { energyAt(position: number): number } | null): MotionFrame {
    const dt = Math.max(0, Math.min(deltaSeconds, MOTION_TUNING.maxFrameStepSeconds));
    const targetPlayback = playing ? 1 : 0;
    const targetAnalysis = track ? 1 : 0;
    this.playbackBlend = this.ease(this.playbackBlend, targetPlayback, dt, MOTION_TUNING.playbackEaseSeconds);
    this.analysisBlend = this.ease(this.analysisBlend, targetAnalysis, dt, MOTION_TUNING.analysisEaseSeconds);

    const targetEnergy = track
      ? track.energyAt(positionSeconds + MOTION_TUNING.energyLeadSeconds)
      : MOTION_TUNING.neutralEnergy;
    const tau = targetEnergy > this.energy ? MOTION_TUNING.attackSeconds : MOTION_TUNING.releaseSeconds;
    this.energy = this.ease(this.energy, targetEnergy, dt, tau);

    const musicRate = MOTION_TUNING.quietRate + (MOTION_TUNING.loudRate - MOTION_TUNING.quietRate) * this.energy;
    const baseRate = MOTION_TUNING.unanalyzedRate + (musicRate - MOTION_TUNING.unanalyzedRate) * this.analysisBlend;
    const activeRate = MOTION_TUNING.pausedRate + (baseRate - MOTION_TUNING.pausedRate) * this.playbackBlend;
    this.rate = activeRate * MOTION_TUNING.intensity;
    this.scale = 1 + this.energy * MOTION_TUNING.scalePerEnergy * this.analysisBlend * this.playbackBlend;
    this.time += dt * this.rate;
    return { time: this.time, energy: this.energy, rate: this.rate, scale: this.scale };
  }

  private ease(current: number, target: number, dt: number, tau: number): number {
    if (tau <= 0) return target;
    return current + (target - current) * (1 - Math.exp(-dt / tau));
  }
}
