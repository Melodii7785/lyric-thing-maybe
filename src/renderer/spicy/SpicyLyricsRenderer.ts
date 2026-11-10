/*
 * Spicy Lyrics browser renderer adapter.
 * Based on Spicy Lyrics by Spikerko (Copyright 2026).
 * Modified for Lyric Thing experimental browser runtime.
 * Licensed under GNU AGPL-3.0-or-later; see AGPL-3.0.txt.
 */
import { Spring } from "./Spring";
import { SplitLetters } from "./SplitLetters";

export interface SpicyWord {
  word: string;
  startTime: number;
  endTime: number;
}
export interface SpicyLine {
  words: SpicyWord[];
  startTime: number;
  endTime: number;
  isBG?: boolean;
  isDuet?: boolean;
}

type RenderWord = { element: HTMLElement; start: number; end: number; spring: Spring };

export class SpicyLyricsRenderer {
  private root = document.createElement("div");
  private lines: SpicyLine[] = [];
  private words: RenderWord[] = [];
  private currentTime = 0;
  private playing = false;
  private lastFrame = 0;
  private raf = 0;

  constructor() {
    this.root.className = "spicy-lyrics-renderer";
    this.root.setAttribute("aria-label", "Synchronized lyrics");
    this.root.style.cssText = "height:100%;overflow-y:auto;overflow-x:hidden;scroll-behavior:auto;";
    this.raf = requestAnimationFrame(this.frame);
  }

  getElement(): HTMLElement { return this.root; }
  setOptimizeOptions(_options: Record<string, unknown>): void {}
  setLyricLines(lines: SpicyLine[]): void {
    this.lines = Array.isArray(lines) ? lines : [];
    this.words = [];
    this.root.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const line of this.lines) {
      const row = document.createElement("div");
      row.className = "line" + (line.isBG ? " bg-line" : "") + (line.isDuet ? " duet-line" : "");
      row.dataset.startTime = String(line.startTime);
      for (const word of line.words) {
        const span = document.createElement("span");
        span.className = "word";
        span.textContent = word.word;
        row.appendChild(span);
        this.words.push({ element: span, start: word.startTime, end: Math.max(word.startTime + 1, word.endTime), spring: new Spring(0, 3.2, 0.82) });
      }
      fragment.appendChild(row);
    }
    this.root.appendChild(fragment);
    this.updateActiveLine();
  }
  setCurrentTime(time: number, _seek = false): void {
    this.currentTime = Number.isFinite(time) ? time : 0;
    this.updateActiveLine();
  }
  pause(): void { this.playing = false; }
  resume(): void { this.playing = true; }
  update(delta: number): void {
    if (this.playing && Number.isFinite(delta)) this.currentTime += delta;
    this.updateActiveLine();
  }
  private updateActiveLine(): void {
    const rows = Array.from(this.root.children) as HTMLElement[];
    let active: HTMLElement | null = null;
    for (const row of rows) {
      const start = Number(row.dataset.startTime || 0);
      const next = row.nextElementSibling as HTMLElement | null;
      const end = next ? Number(next.dataset.startTime || Infinity) : Infinity;
      const isActive = this.currentTime >= start && this.currentTime < end;
      row.classList.toggle("Active", isActive);
      if (isActive) active = row;
    }
    for (const word of this.words) {
      const progress = Math.max(0, Math.min(1, (this.currentTime - word.start) / (word.end - word.start)));
      word.spring.SetGoal(progress);
    }
    if (active) {
      const rootRect = this.root.getBoundingClientRect();
      const rowRect = active.getBoundingClientRect();
      const target = active.offsetTop - this.root.clientHeight * 0.42;
      if (rowRect.top < rootRect.top + 24 || rowRect.bottom > rootRect.bottom - 24) {
        this.root.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      }
    }
  }
  private frame = (now: number): void => {
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.05) : 0;
    this.lastFrame = now;
    if (this.playing) this.currentTime += dt * 1000;
    for (const word of this.words) {
      const value = word.spring.Step(dt);
      const pct = Math.max(0, Math.min(1, value)) * 100;
      word.element.style.setProperty("--spicy-fill", pct + "%");
    }
    this.updateActiveLine();
    this.raf = requestAnimationFrame(this.frame);
  };
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.root.replaceChildren();
    this.words = [];
    this.lines = [];
  }
}
