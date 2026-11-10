let element: HTMLElement | null = null;
export const ScrollSimplebar = {
  recalculate() {},
  getScrollElement() { return element || document.documentElement; }
};
export function MountScrollSimplebar(target?: HTMLElement) { element = target || document.documentElement; }
export function ClearScrollSimplebar() { element = null; }
export function RecalculateScrollSimplebar() {}
