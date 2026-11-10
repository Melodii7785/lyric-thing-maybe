let element: HTMLElement | null = null;
export const ScrollSimplebar = {
  recalculate() {
    if (element) element.dispatchEvent(new Event("scroll"));
  },
  getScrollElement() {
    return element || document.querySelector<HTMLElement>(".LyricsContainer .LyricsContent") || document.documentElement;
  }
};
export function MountScrollSimplebar(target?: HTMLElement) {
  element = target || document.querySelector<HTMLElement>(".LyricsContainer .LyricsContent") || document.documentElement;
  if (element !== document.documentElement) {
    element.style.overflowY = "auto";
    element.style.overscrollBehavior = "contain";
  }
}
export function ClearScrollSimplebar() {
  if (element && element !== document.documentElement) {
    element.style.overflowY = "";
    element.style.overscrollBehavior = "";
  }
  element = null;
}
export function RecalculateScrollSimplebar() {
  ScrollSimplebar.recalculate();
}
