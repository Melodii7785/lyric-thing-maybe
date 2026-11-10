/**
 * Lyric Thing browser adapter for the original Spicetify stores.
 * Store API intentionally matches nanostores' get/set shape used upstream.
 */
export function atom<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set(next: T) { value = next; listeners.forEach(listener => listener(value)); },
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
export const $lyricsContainerExists = atom(true);
export const $minimalLyricsMode = atom(false);
export const $simpleLyricsMode = atom(false);
export const $currentLyricsType = atom<"Syllable" | "Line" | "Static">("Syllable");
export const $joinSplitWords = atom(false);
export const $smoothScrolling = atom(true);
export const $experiment = atom<Record<string, boolean>>({});
export const $seekFadeCompensation = atom(false);
