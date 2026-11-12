let queued = false;
let lastActive: HTMLElement | null = null;
let userScrollUntil = 0;
let programmaticScrollUntil = 0;
let observedScroller: HTMLElement | null = null;

function findScroller(active: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = active.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (node.scrollHeight > node.clientHeight + 2 && /(auto|scroll)/.test(style.overflowY)) {
      return node;
    }
    node = node.parentElement;
  }
  return active.closest<HTMLElement>(".LyricsContent");
}

function watchManualScroll(scroller: HTMLElement) {
  if (observedScroller === scroller) return;
  observedScroller?.removeEventListener("scroll", onScroll);
  observedScroller = scroller;
  observedScroller.addEventListener("scroll", onScroll, { passive: true });
}

function onScroll() {
  if (performance.now() < programmaticScrollUntil) return;
  userScrollUntil = performance.now() + 2200;
}

export function QueueForceScroll(force = false) {
  const active = document.querySelector<HTMLElement>(
    "#SpicyLyricsPage.SpicyRenderer .LyricsContent .line.Active, #SpicyLyricsPage.SpicyRenderer .LyricsContent .line.active"
  );
  if (!active) {
    lastActive = null;
    return;
  }
  const changed = active !== lastActive;
  if (!force && !changed && performance.now() < userScrollUntil) return;
  if (queued || (!force && !changed && performance.now() < programmaticScrollUntil)) return;

  const scroller = findScroller(active);
  if (!scroller) return;
  watchManualScroll(scroller);
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (!active.isConnected || !active.classList.contains("Active") && !active.classList.contains("active")) return;
    const a = active.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const offset = a.top - s.top;
    const target = scroller.scrollTop + offset - (s.height - a.height) / 2;
    const drift = Math.abs(offset - (s.height - a.height) / 2);
    if (!Number.isFinite(target) || drift < 12) {
      lastActive = active;
      return;
    }
    if (!force && !changed && performance.now() < userScrollUntil) return;
    lastActive = active;
    programmaticScrollUntil = performance.now() + 650;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  });
}
