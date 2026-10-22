interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OAUTH_STATE: KVNamespace;
  APP_ORIGIN: string;
  SPOTIFY_REDIRECT_URI: string;
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
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
      scope: "user-read-playback-state user-read-currently-playing", state,
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
    if (!tokenResponse.ok) return Response.redirect(appUrl(env) + "?spotify_error=token_exchange_failed", 302);
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
    if (!response.ok) return json({ error: "spotify_request_failed", status: response.status }, 502);
    const data = await response.json() as any;
    if (!data?.item) return json({ playing: false, track: null });
    const track = data.item;
    return json({ playing: !!data.is_playing, progressMs: data.progress_ms ?? null, track: {
      id: track.id ?? null, title: track.name ?? "Unknown track",
      artists: Array.isArray(track.artists) ? track.artists.map((a: any) => a.name).filter(Boolean) : [],
      album: track.album?.name ?? null, image: track.album?.images?.[0]?.url ?? null,
      durationMs: track.duration_ms ?? null, uri: track.uri ?? null,
    }});
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
