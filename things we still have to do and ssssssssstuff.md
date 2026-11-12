# things we still have to do and ssssssssstuff

okay. so. the renderer is here. the lyrics are lyric-ing. the little words are doing their little animations.

BUT THERE IS MORE.

we still have some Spicy Lyrics stuff to bring over, some things to polish, and some things to poke with a stick until they work. this is the list. behold.

## customization stuff (the next big thing!!)

- [ ] go through the original Spicy Lyrics settings and see what we're missing.
- [ ] port the useful customization options into Lyric Thing.
- [ ] make sure the options actually affect the original renderer. a pretty checkbox that does absolutely nothing is NOT a feature.
- [ ] make settings stick around after refreshing the page.
- [ ] test the settings at different screen sizes, because not everyone is browsing from a cinema screen.

## lyrics-related shenanigans

- [ ] romanization support. let the syllables have subtitles or whatever the correct technical term is.
- [ ] translation support. lyrics in languages you can actually understand! perhaps!
- [ ] playback offset adjustment, for when the lyrics and the music are having two separate appointments.
- [ ] check how all of this works with syllable-, line-, and static-timed lyrics.
- [ ] make sure missing metadata doesn't cause the renderer to fall down the stairs.

## renderer polish (we are NOT done poking it)

- [ ] compare our port with the original Spicy Lyrics renderer and find any missing behavior.
- [ ] test syllable lyrics.
- [ ] test line lyrics.
- [ ] test static lyrics.
- [ ] test background vocals and their styling. the background singers deserve equal rights.
- [ ] test font selection, zoom, glow, animation settings, and Simple Lyrics Mode together.
- [ ] make sure renderer switching and the AMLL fallback still behave.
- [ ] check keyboard controls, pointer controls, and manual scrolling.
- [ ] run the typecheck/build and fix whatever gremlins it finds.

## the "later. maybe. someday." pile

not the current priority. these can sit over there for a bit.

- [ ] offline lyrics and caching.
- [ ] TTML importing.
- [ ] a persistent local lyrics library.
- [ ] Lyrics Manager.

## the order we're doing things in

1. customization options first. make the renderer ours.
2. romanization.
3. translations.
4. playback offset adjustment.
5. a proper compatibility and regression-testing pass. the bug hunt. the grand bug hunt.

## VERY IMPORTANT NOTES. PLEASE READ. THANK YOU.

- we're continuing on `port/original-spicy-lyrics-engine`. we do NOT need another branch. the branch population is sufficient.
- the original Spicy Lyrics renderer is the preferred renderer for supported Spicy Lyrics responses. AMLL is still here as an alternative and fallback.
- background vocal size is **60%**. this has been approved. do not go fiddling with the sacred 60% unless we specifically decide to.
- this is a to-do list, not a claim that all these features are already implemented or fully scoped. check the original renderer before porting things. we don't want to spend three hours rebuilding a thing that was already sitting there.

and that's the current list of things we still have to do and ssssssssstuff.

more ssssssssstuff may be added when discovered. probably will be, honestly.
