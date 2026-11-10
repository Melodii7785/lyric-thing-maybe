const listeners = new Set<() => void>();
export function EmitApply() { listeners.forEach(fn => fn()); }
export function EmitNotApplyed() { listeners.forEach(fn => fn()); }
export function onApply(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
