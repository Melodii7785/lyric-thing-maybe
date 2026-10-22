# lyric thing™

A browser-based lyrics finder prototype.

## Planned features

- MusicBrainz recording search and version selection
- Timed lyric lookup through lrc.red, with LRCLIB fallback
- Release information and cover art
- Experimental Spotify playback detection

## Status

This repository is a work in progress. The Cloudflare Workers Builds pipeline is configured for the `main` branch. Production builds run `npm run typecheck` before deploying with Wrangler. The live Spotify OAuth/playback flow still needs to be tested after deployment.

## Security

Never commit Spotify client secrets, token-encryption keys, access tokens, or refresh tokens. Keep secrets in Cloudflare Worker secrets, never browser code or this repository.

## Deployment

The Worker uses Cloudflare static assets, D1, and KV. Before public launch, test OAuth and playback, add privacy/consent handling, and review Spotify's current developer policies.
