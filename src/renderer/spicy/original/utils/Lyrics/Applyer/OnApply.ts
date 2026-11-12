const listeners = new Set<() => void>();
export function EmitApply(..._args: unknown[]) { listeners.forEach(fn => fn()); }
export function EmitNotApplyed(..._args: unknown[]) { listeners.forEach(fn => fn()); }
export function onApply(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
