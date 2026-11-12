/** Browser-side compatibility stores for the original Spicetify engine. */
export function atom<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  const store = (() => value) as (() => T) & {
    get: () => T;
    set: (next: T) => void;
    subscribe: (listener: (value: T) => void) => () => void;
    listen: (listener: (value: T) => void) => () => void;
  };
  store.get = () => value;
  store.set = (next: T) => { value = next; listeners.forEach(listener => listener(value)); };
  store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  store.listen = store.subscribe;
  return store;
}
export const $lyricsContainerExists = atom(true);
export const $minimalLyricsMode = atom(false);
export const $simpleLyricsMode = atom(false);
export const $currentLyricsType = atom<"Syllable" | "Line" | "Static" | "None">("None");
export const $joinSplitWords = atom(false);
export const $smoothScrolling = atom(true);
const experimentState = atom<Record<string, boolean>>({});
function atomSelector(name: string) {
  const selected = (() => experimentState.get()[name] === true) as (() => boolean) & {
    get: () => boolean;
    set: (next: boolean) => void;
    listen: (listener: (value: boolean) => void) => () => void;
  };
  selected.get = selected;
  selected.set = (next) => experimentState.set({ ...experimentState.get(), [name]: next });
  selected.listen = (listener) => experimentState.listen(value => listener(value[name] === true));
  return selected;
}
export const $experiment = Object.assign(
  (name: string) => atomSelector(name),
  {
    get: experimentState.get,
    set: experimentState.set,
    listen: experimentState.listen,
    subscribe: experimentState.subscribe,
  }
);
export const $seekFadeCompensation = atom(false);
