# lyric thing™

A browser-based lyrics finder prototype.

## Planned features

- MusicBrainz recording search and version selection
- Timed lyric lookup through lrc.red, with LRCLIB fallback
- Release information and cover art
- Experimental Spotify playback detection

## Status

This repository is a work in progress. The standalone frontend and Cloudflare Worker starter were prepared separately; the live Spotify OAuth/playback flow has not been tested in production.

## Security

Never commit Spotify client secrets, token-encryption keys, access tokens, or refresh tokens. Keep secrets in Cloudflare Worker secrets, never browser code or this repository.

## Planned deployment

Cloudflare Workers with static assets, D1, and KV. Before public launch, configure bindings and secrets, test OAuth and playback, add privacy/consent handling, and review Spotify's current developer policies.
