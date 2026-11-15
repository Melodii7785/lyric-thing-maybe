import { LyricsObject, type SyllableLead } from "./lyrics.ts";

const FADE_EM = 0.882;
const LIFT_EM = 0.0588;
const OMEGA = 5;
const DAMPING = 0.93;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lift(elapsedMs: number) {
  if (elapsedMs <= 0) return 0;
  const t = elapsedMs / 1000;
  const decay = Math.exp(-DAMPING * OMEGA * t);
  if (decay < 1e-4) return 1;
  const wd = OMEGA * Math.sqrt(1 - DAMPING * DAMPING);
  return 1 - decay * (
    Math.cos(wd * t) + (DAMPING * OMEGA / wd) * Math.sin(wd * t)
  );
}

function setStyle(element: HTMLElement, property: string, value: string) {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
}

function lineTone(position: number, start: number, end: number) {
  if (position < start) return 0.18;
  if (position <= end) {
    const progress = clamp((position - start) / Math.max(1, end - start), 0, 1);
    return 0.18 + (0.94 - 0.18) * progress;
  }
  const elapsed = position - end - 250;
  if (elapsed <= 0) return 0.94;
  const progress = clamp(elapsed / 350, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 2);
  return 0.94 + (0.18 - 0.94) * eased;
}

function gradientPosition(edge: number, x: number, width: number, fade: number) {
  if (!Number.isFinite(edge)) return -50;
  const rest = (width + fade / 2 - (edge - x)) / (width + fade);
  return clamp(100 - 150 * rest, -50, 100);
}

function applySyllableLine(line: any, position: number) {
  const element = line.HTMLElement as HTMLElement;
  const words = line.Syllables?.Lead as SyllableLead[] | undefined;
  if (!words?.length) return;

  const lineRect = element.getBoundingClientRect();
  const fontSize = parseFloat(getComputedStyle(element).fontSize) || 48;
  const fade = fontSize * FADE_EM;
  const halfFade = fade / 2;
  const measured = words.map((word) => {
    if (word.Dot) return null;
    const rect = word.HTMLElement.getBoundingClientRect();
    return {
      word,
      x: rect.left - lineRect.left,
      width: rect.width,
      row: Math.round((rect.top - lineRect.top) / Math.max(1, fontSize * 0.65)),
    };
  });

  const edges = new Array<number>(words.length).fill(Number.NEGATIVE_INFINITY);
  let carried = Number.NEGATIVE_INFINITY;
  let previousRow = -1;
  for (let i = 0; i < measured.length; i++) {
    const item = measured[i];
    if (!item) continue;
    if (item.row !== previousRow) {
      carried = Number.NEGATIVE_INFINITY;
      previousRow = item.row;
    }
    const from = Number.isFinite(carried)
      ? Math.max(item.x - halfFade, carried)
      : item.x - halfFade;
    const to = Math.max(from, item.x + item.width + fade * 0.25 - halfFade);
    let edge = Number.NEGATIVE_INFINITY;
    if (position >= item.word.EndTime) edge = to;
    else if (position > item.word.StartTime) {
      const progress = clamp(
        (position - item.word.StartTime) / Math.max(1, item.word.EndTime - item.word.StartTime),
        0,
        1
      );
      edge = from + (to - from) * progress;
    }
    edges[i] = edge;
    if (Number.isFinite(edge)) carried = Math.max(carried, edge);
  }

  for (let i = 0; i < measured.length; i++) {
    const item = measured[i];
    if (!item) continue;
    const ownEdge = edges[i];
    const edge = Number.isFinite(ownEdge)
      ? ownEdge
      : measured.slice(0, i).reduce((last, previous, j) => {
          if (!previous || previous.row !== item.row) return last;
          return Number.isFinite(edges[j]) ? Math.max(last, edges[j]) : last;
        }, Number.NEGATIVE_INFINITY);
    const value = gradientPosition(edge, item.x, item.width, fade).toFixed(2) + "%";
    setStyle(item.word.HTMLElement, "--gradient-position", value);
    const wordLift = position < line.EndTime
      ? lift(position - item.word.StartTime)
      : lift(item.word.EndTime - item.word.StartTime) * (1 - lift(position - line.EndTime));
    item.word.HTMLElement.style.translate = `0 ${(-LIFT_EM * wordLift).toFixed(4)}em`;

    if (item.word.LetterGroup && item.word.Letters) {
      for (const letter of item.word.Letters) {
        const rect = letter.HTMLElement.getBoundingClientRect();
        const x = rect.left - lineRect.left;
        const letterProgress = position <= letter.StartTime
          ? -50
          : gradientPosition(
              x + rect.width * clamp((position - letter.StartTime) / Math.max(1, letter.EndTime - letter.StartTime), 0, 1),
              x,
              rect.width,
              fade
            );
        setStyle(letter.HTMLElement, "--gradient-position", letterProgress.toFixed(2) + "%");
        const letterLift = position < line.EndTime
          ? lift(position - letter.StartTime)
          : lift(letter.EndTime - letter.StartTime) * (1 - lift(position - line.EndTime));
        letter.HTMLElement.style.translate = `0 ${(-LIFT_EM * letterLift).toFixed(4)}em`;
      }
    }
  }
}

export function applyBloomAnimation(position: number, type: string) {
  if (type === "Syllable") {
    for (const line of LyricsObject.Types.Syllable.Lines) {
      const element = line.HTMLElement;
      if (!element.isConnected) continue;
      const active = position >= line.StartTime && position <= line.EndTime;
      element.style.scale = active ? "1" : "0.98";
      setStyle(element, "--gradient-alpha", "0.94");
      setStyle(element, "--gradient-alpha-end", "0.18");
      if (line.DotLine) continue;
      applySyllableLine(line, position);
    }
    return;
  }

  if (type === "Line") {
    for (const line of LyricsObject.Types.Line.Lines) {
      const element = line.HTMLElement;
      if (!element.isConnected) continue;
      const tone = lineTone(position, line.StartTime, line.EndTime);
      element.style.scale = position >= line.StartTime && position <= line.EndTime ? "1" : "0.98";
      setStyle(element, "--gradient-alpha", tone.toFixed(3));
      setStyle(element, "--gradient-alpha-end", "0.18");
      setStyle(element, "--gradient-position", (
        position < line.StartTime ? -50 :
        position >= line.EndTime ? 100 :
        -50 + 150 * clamp((position - line.StartTime) / Math.max(1, line.EndTime - line.StartTime), 0, 1)
      ).toFixed(2) + "%");
    }
    return;
  }

  for (const line of LyricsObject.Types.Static.Lines) {
    if (line.HTMLElement.isConnected) {
      setStyle(line.HTMLElement, "--gradient-alpha", "0.94");
      setStyle(line.HTMLElement, "--gradient-alpha-end", "0.18");
      setStyle(line.HTMLElement, "--gradient-position", "100%");
    }
  }
}
