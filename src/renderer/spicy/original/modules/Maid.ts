export class Maid {
  private cleanups: Array<() => void> = [];
  Give<T extends { disconnect?: () => void }>(resource: T): T;
  Give(cleanup: () => void): () => void;
  Give<T extends { disconnect?: () => void }>(resource: T | (() => void)): T | (() => void) {
    if (typeof resource === "function") this.cleanups.push(resource);
    else this.cleanups.push(() => resource.disconnect?.());
    return resource;
  }
  Destroy() { for (const cleanup of this.cleanups.splice(0).reverse()) cleanup(); }
}
