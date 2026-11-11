export default class Logger {
  constructor(private name: string) {}
  get isEnabled() { return true; }
  log(...args: unknown[]) { console.log("[", this.name, "]", ...args); }
  info(...args: unknown[]) { console.info("[", this.name, "]", ...args); }
  debug(...args: unknown[]) { console.debug("[", this.name, "]", ...args); }
  warn(...args: unknown[]) { console.warn("[", this.name, "]", ...args); }
  error(...args: unknown[]) { console.error("[", this.name, "]", ...args); }
}
