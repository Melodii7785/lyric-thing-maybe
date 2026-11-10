const events = new Map<string, Set<(...args: unknown[]) => void>>();
const Global = { Event: { evoke(name: string, ...args: unknown[]) { events.get(name)?.forEach(fn => fn(...args)); }, on(name: string, fn: (...args: unknown[]) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(fn); return () => events.get(name)?.delete(fn); } } };
export default Global;
