type KeyUsage = "encrypt" | "decrypt" | "sign" | "verify" | "deriveKey" | "deriveBits" | "wrapKey" | "unwrapKey";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OAUTH_STATE: KVNamespace;
  APP_ORIGIN: string;
  SPOTIFY_REDIRECT_URI: string;
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  SL_SECRET: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}
interface Session {
  session_hash: string;
  user_id: number;
  spotify_user_id: string;
  display_name: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: number;
  session_expires_at: number;
}

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function spotifyUpstreamDiagnostics(endpoint: string, response: Response) {
  const diagnostics = {
    endpoint,
    status: response.status,
    requestId: response.headers.get("x-spotify-request-id") || response.headers.get("x-request-id") || null,
    retryAfter: response.headers.get("retry-after") || null,
    contentType: response.headers.get("content-type") || null,
  };
  // Deliberately omit response bodies, authorization headers, tokens, and user data.
  console.warn("Spotify Web API request failed", diagnostics);
  return {
    upstreamStatus: diagnostics.status,
    upstreamRequestId: diagnostics.requestId,
    retryAfter: diagnostics.retryAfter,
  };
}

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(value: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
}
function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.trim().indexOf("=");
    if (i >= 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}
function sessionCookie(value: string, age: number): string {
  return `lt_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}
function clearCookie(): string {
  return "lt_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
function appUrl(env: Env): string { return new URL("/", env.APP_ORIGIN).toString(); }
function validOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === env.APP_ORIGIN;
}
async function encryptionKey(env: Env, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(env.TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be base64-encoded 32 random bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usage);
}
async function encrypt(env: Env, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env, ["encrypt"]), new TextEncoder().encode(value));
  const joined = new Uint8Array(iv.length + cipher.byteLength);
  joined.set(iv); joined.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...joined));
}
async function decrypt(env: Env, value: string): Promise<string> {
  const joined = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: joined.slice(0, 12) }, await encryptionKey(env, ["decrypt"]), joined.slice(12));
  return new TextDecoder().decode(plain);
}
async function getSession(request: Request, env: Env): Promise<Session | null> {
  const raw = cookie(request, "lt_session");
  if (!raw) return null;
  return env.DB.prepare(`
    SELECT s.session_hash, s.user_id, u.spotify_user_id, u.display_name,
           s.access_token_enc, s.refresh_token_enc, s.access_expires_at, s.session_expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.session_hash = ? AND s.session_expires_at > ?
  `).bind(await sha256(decodeURIComponent(raw)), Math.floor(Date.now() / 1000)).first<Session>();
}
async function refresh(session: Session, env: Env): Promise<Session> {
  if (session.access_expires_at > Math.floor(Date.now() / 1000) + 60) return session;
  const refreshToken = await decrypt(env, session.refresh_token_enc);
  if (!refreshToken) throw new Error("No refresh token; reconnect Spotify");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(env.CLIENT_ID + ":" + env.CLIENT_SECRET),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: env.CLIENT_ID }),
  });
  if (!response.ok) throw new Error("Spotify token refresh failed");
  const token = await response.json() as TokenResponse;
  const accessEnc = await encrypt(env, token.access_token);
  const refreshEnc = token.refresh_token ? await encrypt(env, token.refresh_token) : session.refresh_token_enc;
  const expires = Math.floor(Date.now() / 1000) + token.expires_in;
  await env.DB.prepare("UPDATE sessions SET access_token_enc = ?, refresh_token_enc = ?, access_expires_at = ? WHERE session_hash = ?")
    .bind(accessEnc, refreshEnc, expires, session.session_hash).run();
  return { ...session, access_token_enc: accessEnc, refresh_token_enc: refreshEnc, access_expires_at: expires };
}
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if ((path.startsWith("/api/") || path.startsWith("/auth/")) && !validOrigin(request, env)) return json({ error: "origin_not_allowed" }, 403);

  if (path === "/api/health" && request.method === "GET") return json({ ok: true });
  if (path === "/auth/login" && request.method === "GET") {
    const state = randomToken(24);
    await env.OAUTH_STATE.put("state:" + state, "valid", { expirationTtl: 600 });
    const authorize = new URL("https://accounts.spotify.com/authorize");
    authorize.search = new URLSearchParams({
      response_type: "code", client_id: env.CLIENT_ID,
      redirect_uri: env.SPOTIFY_REDIRECT_URI,
      scope: "user-read-playback-state user-read-currently-playing user-modify-playback-state", state,
    }).toString();
    return Response.redirect(authorize.toString(), 302);
  }
  if (path === "/auth/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (error) return Response.redirect(appUrl(env) + "?spotify_error=" + encodeURIComponent(error), 302);
    if (!code || !state) return json({ error: "missing_oauth_parameters" }, 400);
    const key = "state:" + state;
    const valid = await env.OAUTH_STATE.get(key);
    await env.OAUTH_STATE.delete(key);
    if (!valid) return json({ error: "invalid_or_expired_state" }, 400);

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: "Basic " + btoa(env.CLIENT_ID + ":" + env.CLIENT_SECRET),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.SPOTIFY_REDIRECT_URI }),
    });
    if (!tokenResponse.ok) {
      let upstreamError: { error?: string; error_description?: string } = {};
      try { upstreamError = await tokenResponse.json() as typeof upstreamError; } catch { /* ignore non-JSON responses */ }
      // Log only Spotify's non-secret error code and HTTP status. Never log the
      // authorization code, client secret, tokens, or the full response body.
      console.warn("Spotify token exchange failed", {
        status: tokenResponse.status,
        error: upstreamError.error || "unknown",
        hasClientId: !!env.CLIENT_ID,
        hasClientSecret: !!env.CLIENT_SECRET,
        hasRedirectUri: !!env.SPOTIFY_REDIRECT_URI,
      });
      const failure = new URL(appUrl(env));
      failure.searchParams.set("spotify_error", "token_exchange_failed");
      failure.searchParams.set("spotify_reason", upstreamError.error || "unknown");
      failure.searchParams.set("spotify_status", String(tokenResponse.status));
      return Response.redirect(failure.toString(), 302);
    }
    const token = await tokenResponse.json() as TokenResponse;
    if (!token.refresh_token) return Response.redirect(appUrl(env) + "?spotify_error=missing_refresh_token", 302);
    const meResponse = await fetch(API_URL + "/me", { headers: { authorization: "Bearer " + token.access_token } });
    if (!meResponse.ok) return Response.redirect(appUrl(env) + "?spotify_error=profile_lookup_failed", 302);
    const me = await meResponse.json() as { id: string; display_name?: string | null };
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`
      INSERT INTO users (spotify_user_id, display_name, created_at) VALUES (?, ?, ?)
      ON CONFLICT(spotify_user_id) DO UPDATE SET display_name = excluded.display_name
    `).bind(me.id, me.display_name || null, now).run();
    const user = await env.DB.prepare("SELECT id FROM users WHERE spotify_user_id = ?").bind(me.id).first<{id: number}>();
    if (!user) return json({ error: "user_persistence_failed" }, 500);
    const rawSession = randomToken();
    const hash = await sha256(rawSession);
    await env.DB.prepare(`
      INSERT INTO sessions (session_hash, user_id, access_token_enc, refresh_token_enc, access_expires_at, session_expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(hash, user.id, await encrypt(env, token.access_token), await encrypt(env, token.refresh_token), now + token.expires_in, now + SESSION_SECONDS, now).run();
    return new Response(null, { status: 302, headers: { location: appUrl(env), "cache-control": "no-store", "set-cookie": sessionCookie(rawSession, SESSION_SECONDS) } });
  }
  if (path === "/api/session" && request.method === "GET") {
    const session = await getSession(request, env);
    return json({ connected: !!session, user: session ? { displayName: session.display_name } : null });
  }
  if (path === "/api/spotify/devices" && request.method === "GET") {
    let session = await getSession(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    try { session = await refresh(session, env); }
    catch {
      await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(session.session_hash).run();
      return json({ error: "spotify_reconnect_required" }, 401);
    }
    const response = await fetch(API_URL + "/me/player/devices", {
      headers: { authorization: "Bearer " + await decrypt(env, session.access_token_enc), accept: "application/json" },
    });
    if (response.status === 401) return json({ error: "spotify_reconnect_required" }, 401);
    if (!response.ok) return json({
      error: response.status === 403 ? "spotify_access_denied" : "spotify_devices_failed",
      ...spotifyUpstreamDiagnostics("/me/player/devices", response),
    }, response.status === 403 ? 403 : 502);
    const data = await response.json() as any;
    return json({ devices: Array.isArray(data.devices) ? data.devices.map((device: any) => ({
      id: device.id ?? null, name: device.name ?? "Spotify device", type: device.type ?? "unknown",
      isActive: !!device.is_active, isRestricted: !!device.is_restricted,
      volumePercent: device.volume_percent ?? null, supportsVolume: !!device.supports_volume,
    })) : [] });
  }
  if (path.startsWith("/api/spotify/player/") && request.method === "POST") {
    let session = await getSession(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    try { session = await refresh(session, env); }
    catch {
      await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(session.session_hash).run();
      return json({ error: "spotify_reconnect_required" }, 401);
    }
    const action = path.slice("/api/spotify/player/".length);
    const allowed: Record<string, { method: string; endpoint: string }> = {
      play: { method: "PUT", endpoint: "/me/player/play" },
      pause: { method: "PUT", endpoint: "/me/player/pause" },
      next: { method: "POST", endpoint: "/me/player/next" },
      previous: { method: "POST", endpoint: "/me/player/previous" },
      transfer: { method: "PUT", endpoint: "/me/player" },
      shuffle: { method: "PUT", endpoint: "/me/player/shuffle" },
      repeat: { method: "PUT", endpoint: "/me/player/repeat" },
      seek: { method: "PUT", endpoint: "/me/player/seek" },
    };
    const command = allowed[action];
    if (!command) return json({ error: "unsupported_player_action" }, 404);
    let body: any = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch { body = {}; }
    }
    const apiUrl = new URL(API_URL + command.endpoint);
    const headers: Record<string, string> = {
      authorization: "Bearer " + await decrypt(env, session.access_token_enc),
      accept: "application/json",
    };
    let requestBody: string | undefined;
    if (action === "transfer") {
      if (typeof body.device_id !== "string" || !body.device_id) return json({ error: "device_required" }, 400);
      requestBody = JSON.stringify({ device_ids: [body.device_id], play: body.play !== false });
      headers["content-type"] = "application/json";
    } else if (action === "shuffle") {
      apiUrl.searchParams.set("state", String(!!body.state));
      if (typeof body.device_id === "string" && body.device_id) apiUrl.searchParams.set("device_id", body.device_id);
    } else if (action === "repeat") {
      if (!["off", "context", "track"].includes(body.state)) return json({ error: "invalid_repeat_state" }, 400);
      apiUrl.searchParams.set("state", body.state);
      if (typeof body.device_id === "string" && body.device_id) apiUrl.searchParams.set("device_id", body.device_id);
    } else if (action === "seek") {
      const position = Number(body.position_ms);
      if (!Number.isFinite(position) || position < 0) return json({ error: "invalid_seek_position" }, 400);
      apiUrl.searchParams.set("position_ms", String(Math.floor(position)));
      if (typeof body.device_id === "string" && body.device_id) apiUrl.searchParams.set("device_id", body.device_id);
    } else if (["play", "pause", "next", "previous"].includes(action) && typeof body.device_id === "string" && body.device_id) {
      apiUrl.searchParams.set("device_id", body.device_id);
    }
    const response = await fetch(apiUrl.toString(), { method: command.method, headers, body: requestBody });
    if (response.status === 401) return json({ error: "spotify_reconnect_required" }, 401);
    if (response.status === 403) {
      const details = await response.text().catch(() => "");
      return json({ error: "spotify_access_denied", action, details: details.slice(0, 500) }, 403);
    }
    if (response.status === 404) return json({ error: "spotify_no_active_device" }, 404);
    if (response.status === 429) return json({ error: "spotify_rate_limited" }, 429);
    if (!response.ok) return json({
      error: "spotify_command_failed",
      ...spotifyUpstreamDiagnostics(command.endpoint, response),
    }, 502);
    return json({ ok: true });
  }
  if (path === "/api/spotify/playback" && request.method === "GET") {
    let session = await getSession(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    try { session = await refresh(session, env); }
    catch {
      await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(session.session_hash).run();
      return json({ error: "spotify_reconnect_required" }, 401);
    }
    const response = await fetch(API_URL + "/me/player/currently-playing", { headers: { authorization: "Bearer " + await decrypt(env, session.access_token_enc), accept: "application/json" } });
    if (response.status === 204 || response.status === 202) return json({ playing: false, track: null });
    if (response.status === 401) return json({ error: "spotify_reconnect_required" }, 401);
    if (response.status === 403) return json({ error: "spotify_access_denied" }, 403);
    if (!response.ok) return json({
      error: "spotify_request_failed",
      ...spotifyUpstreamDiagnostics("/me/player/currently-playing", response),
    }, 502);
    const data = await response.json() as any;
    if (!data?.item) return json({ playing: false, track: null });
    const track = data.item;
    return json({ playing: !!data.is_playing, progressMs: data.progress_ms ?? null, repeatState: data.repeat_state ?? "off", shuffleState: !!data.shuffle_state, track: {
      id: track.id ?? null, title: track.name ?? "Unknown track",
      artists: Array.isArray(track.artists) ? track.artists.map((a: any) => a.name).filter(Boolean) : [],
      album: track.album?.name ?? null, image: track.album?.images?.[0]?.url ?? null,
      durationMs: track.duration_ms ?? null, uri: track.uri ?? null,
    }});
  }
  if (path === "/api/cover-proxy" && request.method === "GET") {
    const target = url.searchParams.get("url");
    if (!target) return json({ error: "missing_url" }, 400);
    let imageUrl: URL;
    try { imageUrl = new URL(target); }
    catch { return json({ error: "invalid_url" }, 400); }
    // Only proxy Apple's artwork CDN; don't turn this endpoint into an open proxy.
    if (!/(^|\.)mzstatic\.com$/i.test(imageUrl.hostname)) return json({ error: "unsupported_image_host" }, 400);
    const image = await fetch(imageUrl.toString(), {
      headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!image.ok) return json({ error: "cover_fetch_failed", status: image.status }, 502);
    const headers = new Headers();
    headers.set("content-type", image.headers.get("content-type") || "image/jpeg");
    headers.set("cache-control", "public, max-age=86400");
    return new Response(image.body, { status: 200, headers });
  }

  if (path === "/api/apple-motion" && request.method === "GET") {
    let session = await getSession(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    try { session = await refresh(session, env); }
    catch { return json({ error: "spotify_reconnect_required" }, 401); }

    const playbackResponse = await fetch(API_URL + "/me/player/currently-playing", {
      headers: { authorization: "Bearer " + await decrypt(env, session.access_token_enc), accept: "application/json" },
    });
    if (playbackResponse.status === 204 || playbackResponse.status === 202) return json({ error: "nothing_playing" }, 404);
    if (!playbackResponse.ok) return json({ error: "spotify_request_failed", status: playbackResponse.status }, 502);
    const playback = await playbackResponse.json() as any;
    const track = playback?.item;
    if (!track) return json({ error: "nothing_playing" }, 404);

    const artist = String(track.artists?.[0]?.name || "");
    const album = String(track.album?.name || "");
    const title = String(track.name || "");
    if (!artist || !album) return json({ error: "not_enough_metadata" }, 400);

    const motionUrl = new URL("https://artwork.m8tec.top/api/v1/artwork/search");
    motionUrl.search = new URLSearchParams({ artist, album, ...(title ? { title } : {}) }).toString();
    const cache = caches.default;
    const cacheKey = new Request("https://lyricthing-cache.invalid/apple-motion?" + motionUrl.searchParams.toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(motionUrl.toString(), { headers: { accept: "application/json" } });
      if (!response.ok) return json({ error: "apple_motion_search_failed", status: response.status }, 502);
      const data = await response.json() as any;
      const squareUrl = typeof data?.url === "string" ? data.url : null;
      const tallUrl = typeof data?.url_tall === "string" ? data.url_tall : null;
      const payload = { square: squareUrl, tall: tallUrl, artist: data?.artist ?? null, album: data?.album ?? null };
      const out = json(payload);
      if (squareUrl) await cache.put(cacheKey, out.clone());
      return out;
    } catch {
      return json({ error: "apple_motion_unavailable" }, 502);
    }
  }

  if (path === "/api/apple-cover" && request.method === "GET") {
    let session = await getSession(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    try { session = await refresh(session, env); }
    catch { return json({ error: "spotify_reconnect_required" }, 401); }

    const playbackResponse = await fetch(API_URL + "/me/player/currently-playing", {
      headers: { authorization: "Bearer " + await decrypt(env, session.access_token_enc), accept: "application/json" },
    });
    if (playbackResponse.status === 204 || playbackResponse.status === 202) return json({ error: "nothing_playing" }, 404);
    if (!playbackResponse.ok) return json({ error: "spotify_request_failed", status: playbackResponse.status }, 502);

    const playback = await playbackResponse.json() as any;
    const track = playback?.item;
    if (!track) return json({ error: "nothing_playing" }, 404);

    const title = String(track.name || "");
    const artists = Array.isArray(track.artists) ? track.artists.map((artist: any) => String(artist.name || "")).filter(Boolean) : [];
    const album = String(track.album?.name || "");
    const search = new URL("https://itunes.apple.com/search");
    search.search = new URLSearchParams({
      term: [title, artists[0] || "", album].filter(Boolean).join(" "),
      country: "BR",
      media: "music",
      entity: "song",
      limit: "5",
    }).toString();

    // Apple's Search API is rate-limited, so cache each lookup by its exact query.
    const cache = caches.default;
    const cacheKey = new Request("https://lyricthing-cache.invalid/apple-cover?" + search.searchParams.toString());
    let appleData: { results?: any[] };
    const cached = await cache.match(cacheKey);
    if (cached) {
      appleData = await cached.json() as { results?: any[] };
    } else {
      const appleResponse = await fetch(search.toString(), { headers: { accept: "application/json" } });
      if (!appleResponse.ok) {
        return json({
          error: appleResponse.status === 429 ? "apple_rate_limited" : "apple_search_failed",
          status: appleResponse.status,
          retryAfter: appleResponse.headers.get("Retry-After"),
          hint: appleResponse.status === 429 ? "Apple said slow down. This endpoint now caches successful searches so the same song will not keep asking Apple." : null,
        }, appleResponse.status === 429 ? 429 : 502);
      }
      appleData = await appleResponse.json() as { results?: any[] };
      await cache.put(cacheKey, new Response(JSON.stringify(appleData), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
      }));
    }
    const normalize = (value: unknown) => String(value || "").toLocaleLowerCase("en-US").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

    const wantedTitle = normalize(title);
    const wantedArtist = normalize(artists[0]);
    const wantedAlbum = normalize(album);
    const scored = (Array.isArray(appleData.results) ? appleData.results : [])
      .filter(result => result && typeof result.artworkUrl100 === "string")
      .map(result => {
        const resultTitle = normalize(result.trackName);
        const resultArtist = normalize(result.artistName);
        const resultAlbum = normalize(result.collectionName);
        let score = 0;
        if (resultTitle === wantedTitle) score += 100;
        else if (resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle)) score += 45;
        if (wantedArtist && (resultArtist === wantedArtist || resultArtist.includes(wantedArtist) || wantedArtist.includes(resultArtist))) score += 50;
        if (wantedAlbum && (resultAlbum === wantedAlbum || resultAlbum.includes(wantedAlbum) || wantedAlbum.includes(resultAlbum))) score += 35;
        return { result, score };
      })
      .sort((a, b) => b.score - a.score);

    const results = scored.map(({ result, score }) => ({
      score,
      track: result.trackName ?? null,
      artist: result.artistName ?? null,
      album: result.collectionName ?? null,
      artwork: typeof result.artworkUrl100 === "string"
        ? result.artworkUrl100.replace(/100x100(?:bb)?/i, "1500x1500bb")
        : null,
    }));
    return json({
      spotify: { title, artists, album },
      best: results[0] ?? null,
      candidates: results,
    });
  }
  if (path === "/api/spotify/analysis" && request.method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    const trackId = url.searchParams.get("trackId") || "";
    if (!/^[A-Za-z0-9]{22}$/.test(trackId)) return json({ error: "invalid_track_id" }, 400);

    // Only fetch analysis for the account's currently playing track.
    let playbackResponse: Response;
    try {
      const freshSession = await refresh(session, env);
      playbackResponse = await fetch(API_URL + "/me/player/currently-playing", {
        headers: { authorization: "Bearer " + await decrypt(env, freshSession.access_token_enc), accept: "application/json" },
      });
    } catch {
      return json({ error: "analysis_unavailable" }, 502);
    }
    if (playbackResponse.status === 204 || playbackResponse.status === 202) return json({ error: "nothing_playing" }, 404);
    if (!playbackResponse.ok) return json({ error: "analysis_unavailable" }, 502);
    const playback = await playbackResponse.json() as any;
    if (playback?.item?.id !== trackId) return json({ error: "track_changed" }, 409);

    // Spotify's web-player analysis endpoint is undocumented. Treat it as optional and fail soft.
    try {
      const embedResponse = await fetch("https://open.spotify.com/embed/track/" + trackId, {
        headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
      });
      if (!embedResponse.ok) return json({ error: "analysis_unavailable" }, 502);
      const embedHtml = await embedResponse.text();
      const nextDataMatch = embedHtml.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!nextDataMatch) return json({ error: "analysis_unavailable" }, 502);
      const pageData = JSON.parse(nextDataMatch[1]);
      const token = pageData?.props?.pageProps?.state?.settings?.session?.accessToken;
      if (typeof token !== "string" || !token) return json({ error: "analysis_unavailable" }, 502);

      const analysisResponse = await fetch("https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/" + trackId + "?format=json", {
        headers: { authorization: "Bearer " + token, "app-platform": "WebPlayer", accept: "application/json" },
      });
      if (!analysisResponse.ok) return json({ error: "analysis_unavailable" }, 502);
      const analysis = await analysisResponse.json() as any;
      const beats = Array.isArray(analysis?.beats) ? analysis.beats
        .filter((beat: any) => Number.isFinite(beat?.start) && Number.isFinite(beat?.duration) && beat.duration > 0)
        .map((beat: any) => ({
          start: beat.start,
          duration: beat.duration,
          confidence: Number.isFinite(beat.confidence) ? beat.confidence : 0.8,
        })) : [];
      if (!beats.length) return json({ error: "analysis_unavailable" }, 502);
      return json({ trackId, tempo: Number.isFinite(analysis?.track?.tempo) ? analysis.track.tempo : null, beats });
    } catch {
      return json({ error: "analysis_unavailable" }, 502);
    }
  }
  if (path === "/api/lyrics" && request.method === "GET") {
    let session = await getSession(request, env);
    if (!session) return json({ error: "not_connected" }, 401);
    try { session = await refresh(session, env); }
    catch {
      await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(session.session_hash).run();
      return json({ error: "spotify_reconnect_required" }, 401);
    }

    const playbackResponse = await fetch(API_URL + "/me/player/currently-playing", {
      headers: { authorization: "Bearer " + await decrypt(env, session.access_token_enc), accept: "application/json" },
    });
    if (playbackResponse.status === 204 || playbackResponse.status === 202) return json({ error: "nothing_playing" }, 404);
    if (playbackResponse.status === 401) return json({ error: "spotify_reconnect_required" }, 401);
    if (!playbackResponse.ok) return json({ error: "spotify_request_failed", status: playbackResponse.status }, 502);

    const playback = await playbackResponse.json() as any;
    const track = playback?.item;
    if (!track) return json({ error: "nothing_playing" }, 404);
    const artists = Array.isArray(track.artists) ? track.artists.map((artist: any) => artist.name).filter(Boolean) : [];
    const trackInfo = { title: track.name ?? "Unknown track", artists, album: track.album?.name ?? null };

    // Spicy Lyrics selects the best available sync (community, Apple Music, or Spotify).
    // The secret stays server-side; only the current track's display data is returned to the app.
    if (env.SL_SECRET && typeof track.id === "string" && /^[A-Za-z0-9]{22}$/.test(track.id)) {
      try {
        const spicyResponse = await fetch("https://api.spicylyrics.org/v1/lyrics/" + encodeURIComponent(track.id), {
          headers: { authorization: "Bearer " + env.SL_SECRET, accept: "application/json" },
        });
        if (spicyResponse.ok) {
          const spicyPayload = await spicyResponse.json() as any;
          const body = spicyPayload?.Body;
          // A non-empty Content array is not enough: some responses contain
          // instrumental/empty vocal entries. Only select Spicy when at least
          // one actual lyric string can be rendered; otherwise keep looking
          // through the normal lrc.red fallback below.
          const hasRenderableVocal = (vocal: any): boolean => {
            if (!vocal || typeof vocal !== "object") return false;
            if ([vocal.Text, vocal.TransliteratedText, vocal.TranslatedText]
              .some(value => typeof value === "string" && value.trim().length > 0)) return true;
            return Array.isArray(vocal.Syllables) && vocal.Syllables.some((syllable: any) =>
              typeof syllable?.Text === "string" && syllable.Text.trim().length > 0
            );
          };
          const hasRenderableLines = Array.isArray(body?.Content) && body.Content.some((entry: any) =>
            hasRenderableVocal(entry?.Lead) ||
            (Array.isArray(entry?.Background) && entry.Background.some(hasRenderableVocal))
          );
          if (body && hasRenderableLines) {
            return json({ track: trackInfo, spicyLyrics: body });
          }
        }
      } catch {
        // If Spicy Lyrics is unavailable, keep the existing lrc.red fallback below.
      }
    }
    const album = track.album?.name ?? null;
    const durationSeconds = typeof track.duration_ms === "number" ? Math.round(track.duration_ms / 1000) : null;
    let isrc = track.external_ids?.isrc ?? null;

    // Spotify's currently-playing response often omits external_ids. Try
    // lrc.red's structured title/artist matcher, then its broad search endpoint.
    const collectIsrcs = (value: any, output: string[] = []): string[] => {
      if (!value || typeof value !== "object") return output;
      if (typeof value.isrc === "string" && value.isrc.trim()) output.push(value.isrc.trim());
      for (const child of Object.values(value)) collectIsrcs(child, output);
      return [...new Set(output)];
    };
    async function getJson(url: string): Promise<any | null> {
      try {
        const response = await fetch(url, { headers: { accept: "application/json" } });
        if (!response.ok) return null;
        return await response.json();
      } catch { return null; }
    }
    const params = new URLSearchParams({
      "song-title": track.name ?? "",
      "song-artist": artists.join(", "),
    });
    if (album) params.set("song-album", album);
    if (durationSeconds) params.set("song-duration", String(durationSeconds));

    const isrcCandidates: string[] = isrc ? [isrc] : [];
    const matched = await getJson("https://lrc.red/match.json?" + params.toString());
    isrcCandidates.push(...collectIsrcs(matched));
    if (isrcCandidates.length === 0 || !isrcCandidates.some(candidate => candidate !== isrc)) {
      const query = new URLSearchParams({ q: [track.name ?? "", ...artists].join(" ") });
      const searched = await getJson("https://lrc.red/search.json?" + query.toString());
      isrcCandidates.push(...collectIsrcs(searched));
    }
    const candidates = [...new Set(isrcCandidates)];
    if (!candidates.length) return json({
      error: "lyrics_not_found", track: { title: track.name, artists, album },
    }, 404);

    let ttml: string | null = null;
    let providerStatus = 404;
    async function tryCandidates(list: string[]): Promise<void> {
      for (const candidate of list.slice(0, 8)) {
        const lyricsResponse = await fetch("https://lrc.red/s/" + encodeURIComponent(candidate) + ".ttml", {
          headers: { accept: "application/ttml+xml, application/xml, text/xml, */*" },
        });
        if (lyricsResponse.status === 404) continue;
        if (!lyricsResponse.ok) { providerStatus = lyricsResponse.status; continue; }
        const candidateTtml = await lyricsResponse.text();
        if (candidateTtml.trim() && candidateTtml.includes("<")) {
          ttml = candidateTtml;
          return;
        }
      }
    }
    await tryCandidates(candidates);
    if (!ttml) {
      const query = new URLSearchParams({ q: [track.name ?? "", ...artists].join(" ") });
      const searched = await getJson("https://lrc.red/search.json?" + query.toString());
      const searchCandidates = collectIsrcs(searched).filter(candidate => !candidates.includes(candidate));
      await tryCandidates(searchCandidates);
    }
    if (!ttml) {
      if (providerStatus !== 404) return json({ error: "lyrics_provider_failed", status: providerStatus }, 502);
      return json({ error: "lyrics_not_found", track: { title: track.name, artists, album } }, 404);
    }
    return json({
      track: { title: track.name, artists, album },
      ttml, provider: "lrc.red", providerUrl: "https://lrc.red/",
    });
  }
  if (path === "/auth/logout" && request.method === "POST") {
    const raw = cookie(request, "lt_session");
    if (raw) await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(await sha256(decodeURIComponent(raw))).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }
  if (path.startsWith("/api/") || path.startsWith("/auth/")) return json({ error: "not_found" }, 404);
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env); }
    catch (error) {
      console.error("Unhandled request error", error instanceof Error ? error.message : "unknown");
      return json({ error: "internal_error" }, 500);
    }
  },
};
