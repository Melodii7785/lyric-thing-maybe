let queued = false;
let lastActive: HTMLElement | null = null;
export function QueueForceScroll(force = false) {
  const active = document.querySelector<HTMLElement>(".LyricsContainer .line.Active, .LyricsContainer .line.active");
  if (!active || (!force && active === lastActive) || queued) return;
  lastActive = active;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (!active.isConnected || !active.classList.contains("Active")) return;
    const scroller = active.closest<HTMLElement>(".LyricsContent");
    if (!scroller) return;
    const a = active.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const target = scroller.scrollTop + a.top - s.top - (s.height - a.height) / 2;
    if (Number.isFinite(target)) scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  });
}
