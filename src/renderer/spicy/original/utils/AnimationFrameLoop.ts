const callbacks = new Set<(time: number) => void>();
let frame = 0;
function tick(time: number) { callbacks.forEach(callback => callback(time)); if (callbacks.size) frame = requestAnimationFrame(tick); else frame = 0; }
export function onAnimationFrame(callback: (time: number) => void) { callbacks.add(callback); if (!frame) frame = requestAnimationFrame(tick); return () => { callbacks.delete(callback); if (!callbacks.size && frame) cancelAnimationFrame(frame); frame = 0; }; }
export function requestCappedFrame(callback: FrameRequestCallback) { return requestAnimationFrame(callback); }
export function cancelCappedFrame(id: number) { cancelAnimationFrame(id); }
