# lyric thing™

A browser-based lyrics companion that detects the currently playing Spotify track and displays timed lyrics.

## Rendering

The frontend uses [Apple Music Like Lyrics (AMLL)](https://github.com/amll-dev/applemusic-like-lyrics), specifically `@applemusic-like-lyrics/core`, for Apple Music-style animated, syllable-level lyric rendering. Spicy Lyrics timing is converted into AMLL's millisecond-based `LyricLine[]` format. lrc.red TTML results use the same renderer when available.

AMLL requires a bundled frontend; Vite builds the browser entry and stylesheet into `dist/`, which Cloudflare Workers serves as static assets.

## Development

- `npm install`
- `npm run dev` to run Wrangler locally
- `npm run typecheck` to type-check the Worker and build the frontend
- `npm run build` to build the frontend bundle

The Worker uses Cloudflare static assets, D1, and KV. Keep Spotify client secrets, token-encryption keys, access tokens, refresh tokens, and the Spicy Lyrics API secret in Cloudflare Worker secrets, never browser code or this repository.

## Licensing

This application is distributed under the GNU Affero General Public License v3.0 only; see [LICENSE](./LICENSE). It incorporates AMLL, which is also licensed under AGPL-3.0-only. The AMLL source is available at [amll-dev/applemusic-like-lyrics](https://github.com/amll-dev/applemusic-like-lyrics). Source for this hosted application is available in this repository.
