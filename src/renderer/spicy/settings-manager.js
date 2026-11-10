// Minimal settings adapter for the Spicy AMLL renderer.
// The host app owns preferences; these defaults keep the renderer self-contained.
const defaults = {
  memeFormat: "Off", simpleLyricsMode: false, swipeLyrics: false,
  amlAnimation: true, showRomanized: false, showTranslation: false,
  trimSyllableSpaces: true, forceWordSync: false
};
const values = { ...defaults };
export const settingsManager = {
  get(key) { return values[key] ?? defaults[key]; },
  set(key, value) { values[key] = value; }
};
