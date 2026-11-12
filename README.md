> **im working on the `port/original-spicy-lyrics-engine` branch for now!**
>
> nothing here for now. go over there buddy.
>
> [go to the port branch →](https://github.com/Melodii7785/lyric-thing-maybe/tree/port/original-spicy-lyrics-engine)

---

# lyric thing™

## a thing that renders lyrics

hi this is my app

i made this

it's a thing™ that shows word-synced (depends) lyrics to whatever you're currently listening to on spotify.

ain't that wonderful? haha.

## how does it work

you connect your spotify account, play something, and lyric thing tries to find lyrics for the currently playing track.

the lyrics can be word-synced, line-synced, or just plain old static text. it depends on what lyric source has them available. hence the "(depends)". i'm not making promises the lyrics cannot keep.

spotify is used for playback information and account connection. lyric thing does not magically know every song's lyrics. it has to go and find them.

## the lyric-rendering business

there are currently two renderer paths:

- **original spicy lyrics** — the original Spicy Lyrics renderer, ported into this here website. this is the preferred renderer.
- **amll** — Apple Music Like Lyrics, used as the alternative renderer and for lyric results that don't use the Spicy Lyrics format.

the original Spicy Lyrics renderer handles the Spicy Lyrics response types directly. other lyric formats, including lrc.red results, can use AMLL instead. if the original renderer has a problem, lyric thing can fall back to AMLL.

you can also change renderer using the little debug switch. it's hidden by default, because most people probably don't need to poke it. if you do, the magic phrase is:

```
helloiammelodii7785showmemydebugthings
```

type that on the page. diagnostics and the renderer switch should appear. you're welcome, fellow button enthusiast.

## making it look nice

the original Spicy Lyrics renderer has a few appearance settings:

- choose a font
- turn simple lyrics mode on or off
- toggle lyric glow and blur
- toggle lyric animations
- adjust the lyric zoom

your appearance preferences are saved on your device, so they should still be there when you come back. neat!

## the technical stuff

the frontend is built with Vite and served by a Cloudflare Worker.

the Worker handles the server-side bits, including Spotify authentication and API requests. Cloudflare D1 and KV are used for app data and temporary state. keep secrets on the server, not in browser code. please. for the love of computers.

the lyric renderers run in the browser:

- [Apple Music Like Lyrics (AMLL)](https://github.com/amll-dev/applemusic-like-lyrics), using `@applemusic-like-lyrics/core`
- the original Spicy Lyrics renderer, adapted from the Spicy Lyrics project and its web implementation

## running it locally

you'll need Node.js and npm. then:

```sh
npm install
npm run dev
```

some other useful commands:

```sh
npm run typecheck
npm run build
```

- `npm run dev` starts the local Wrangler development server.
- `npm run typecheck` checks the Worker and browser TypeScript, then builds the frontend.
- `npm run build` builds the frontend with Vite.

you'll also need to configure the Cloudflare resources and Spotify app credentials for the features that depend on them. put credentials and encryption keys in Worker secrets or local Wrangler secret configuration. do not commit them.

## credits and other important business

this project builds on the work of other people. big thanks to:

- [AMLL / Apple Music Like Lyrics](https://github.com/amll-dev/applemusic-like-lyrics) for the Apple Music-style lyric renderer.
- [Spicy Lyrics](https://github.com/Melodii7785/spicy-lyrics) and the original [Spicy Lyrics web implementation](https://github.com/Mathr81/spicy-lyrics-web), for the renderer this project ports and adapts.

please see the upstream projects for their own contributors, notices, and licensing details. this README is not trying to steal anybody's homework.

## licensing

lyric thing is distributed under the GNU Affero General Public License v3.0 only. see [LICENSE](./LICENSE).

the AMLL project is also licensed under AGPL-3.0-only. third-party components retain their applicable copyright notices and license terms. check the upstream repositories linked above for their details.

and that's lyric thing™.

thanks for stopping by.
