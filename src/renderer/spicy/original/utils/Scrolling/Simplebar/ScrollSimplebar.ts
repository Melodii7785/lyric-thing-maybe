type ScrollLike = { recalculate?: () => void; getScrollElement?: () => HTMLElement };
let instance: ScrollLike | null = null;
export const ScrollSimplebar = { recalculate() { instance?.recalculate?.(); } };
export function MountScrollSimplebar(element?: HTMLElement) { instance = { getScrollElement: () => element || document.documentElement }; }
export function ClearScrollSimplebar() { instance = null; }
export function RecalculateScrollSimplebar() { instance?.recalculate?.(); }
