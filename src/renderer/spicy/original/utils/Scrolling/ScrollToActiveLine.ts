let queued = false;
export function QueueForceScroll() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const active = document.querySelector<HTMLElement>(".LyricsContainer .line.Active, .LyricsContainer .line.active");
    const scroller = document.querySelector<HTMLElement>(".LyricsContainer .LyricsContent");
    if (!active || !scroller) return;
    const a = active.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const target = scroller.scrollTop + a.top - s.top - (s.height - a.height) / 2;
    if (Number.isFinite(target)) scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  });
}
