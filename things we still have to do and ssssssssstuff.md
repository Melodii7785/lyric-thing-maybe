# things we still have to do and ssssssssstuff

the renderer has been ported. the rest of the ecosystem is still catching up. this is the little list of things we still want to bring over, finish, or investigate.

## next up: renderer customization

- [ ] audit the original Spicy Lyrics settings and identify which customization options are still missing.
- [ ] port the useful missing appearance/customization options into Lyric Thing.
- [ ] make sure the settings work with the original renderer, rather than only changing the surrounding UI.
- [ ] check that settings persist after a refresh.
- [ ] test the settings at different viewport sizes.

## lyric features

- [ ] romanization support.
- [ ] translation support.
- [ ] playback offset adjustment.
- [ ] check how each feature should behave with syllable-, line-, and static-timed lyrics.
- [ ] make sure missing or unsupported lyric metadata does not break rendering.

## renderer polish and compatibility

- [ ] compare the port against the original Spicy Lyrics renderer and note any remaining behavior differences.
- [ ] test syllable, line, and static lyric payloads.
- [ ] test background vocals and their styling.
- [ ] test font selection, zoom, glow, animation settings, and Simple Lyrics Mode together.
- [ ] verify renderer switching and the AMLL fallback still behave correctly.
- [ ] check keyboard, pointer, and manual-scroll behavior.
- [ ] run the project typecheck/build and fix any issues it catches.

## later / maybe

these are deliberately not the immediate priorities:

- [ ] offline lyrics and caching.
- [ ] TTML importing.
- [ ] a persistent local lyrics library.
- [ ] a Lyrics Manager.

## order of attack

1. finish the missing customization options.
2. add romanization.
3. add translations.
4. add playback offset adjustment.
5. do a proper compatibility and regression-testing pass.

## notes

- keep working on `port/original-spicy-lyrics-engine`. no new branch explosion, please.
- the original Spicy Lyrics renderer remains the preferred renderer for supported Spicy Lyrics responses; AMLL is still useful as an alternative and fallback.
- background vocal size is currently set to **60%**. that's the approved setting, so leave it alone unless we decide otherwise.
- this is a roadmap, not a claim that every checkbox is fully scoped or implemented. check the original renderer before porting a feature so we don't accidentally reinvent something that's already here.

more ssssssssstuff can be added as we discover it.
