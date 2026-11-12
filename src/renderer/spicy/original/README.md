# Original Spicy Lyrics engine port

This directory is a verbatim source import from [Melodii7785/spicy-lyrics](https://github.com/Melodii7785/spicy-lyrics), kept separate from Lyric Thing's existing experimental renderer while the browser adapter is built.

## What is imported

- The original `LyricsAnimator.ts` and `LyricsSetter.ts` animation/timing implementation.
- The original `LyricsVirtualizer.ts` (TanStack Virtual Core integration, scroll spring, mounted-element coordination).
- The original syllable-, line-, and static-lyrics applyers.
- The original lyrics state/data model.
- Original text utilities, letter emphasis, grapheme splitting, spring physics, and `Mixed.css`.
- The upstream repository's license.

The large animation and virtualizer files are imported intact; this is deliberately not a rewritten approximation.

## Port status

**Source import: done. Runtime integration: not done.**

The imported files still reference the original Spicetify application modules (stores, page view, Spotify player, scrolling, experiments, credits, and animation-frame loop). Their relative imports are preserved as they were upstream, but this isolated snapshot is not yet wired into Lyric Thing and is not expected to compile or run by itself.

The next port stage is to supply narrow browser adapters for those dependencies, then connect the original applyers and animator to Lyric Thing's existing lyric data and Spotify playback clock. The experimental route is the only target. Production entry points are intentionally untouched.

Do not treat the old `SpicyLyricsRenderer.ts` scaffold outside this directory as the original engine; it is the earlier prototype and is not the target implementation.

## Upstream

- Repository: https://github.com/Melodii7785/spicy-lyrics
- Imported source paths retain their upstream relative directory layout below `utils/`, `modules/`, and `css/`.
