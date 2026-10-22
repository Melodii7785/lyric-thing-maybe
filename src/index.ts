export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OAUTH_STATE: KVNamespace;
  APP_ORIGIN: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REDIRECT_URI: string;
  TOKEN_ENCRYPTION_KEY: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== env.APP_ORIGIN) return new Response("Origin not allowed", { status: 403 });

    if (url.pathname === "/api/session" && request.method === "GET") {
      const sid = cookie(request, "lyric_session");
      if (!sid) return json({ connected: false });
      const hash = await sha256(sid);
      const row = await env.DB.prepare("SELECT user_id, session_expires_at FROM sessions WHERE id_hash = ?").bind(hash).first<{user_id:string;session_expires_at:number}>();
      if (!row || row.session_expires_at < Date.now()) return json({ connected: false });
      return json({ connected: true });
    }

    if (url.pathname === "/auth/login" && request.method === "GET") {
      const state = randomToken(24);
      await env.OAUTH_STATE.put("state:" + state, "ok", { expirationTtl: 600 });
      const authorize = new URL("https://accounts.spotify.com/authorize");
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: env.SPOTIFY_CLIENT_ID,
        redirect_uri: env.SPOTIFY_REDIRECT_URI,
        scope: "user-read-playback-state user-read-currently-playing",
        state
      }).toString();
      return Response.redirect(authorize.toString(), 302);
    }

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state || !(await env.OAUTH_STATE.get("state:" + state))) return new Response("Invalid or expired OAuth state", { status: 400 });
      await env.OAUTH_STATE.delete("state:" + state);
      const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET)
        },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.SPOTIFY_REDIRECT_URI })
      });
      if (!tokenResponse.ok) return new Response("Spotify token exchange failed. Check Worker secrets and redirect URI.", { status: 502 });
      const tokens = await tokenResponse.json() as {access_token:string;refresh_token?:string;expires_in:number};
      // This starter deliberately stops short of persisting tokens until the encryption/session
      // implementation is configured and reviewed. Never store provider tokens in plaintext.
      if (!env.TOKEN_ENCRYPTION_KEY) return new Response("Missing TOKEN_ENCRYPTION_KEY Worker secret", { status: 500 });
      return new Response("Spotify authorization succeeded. Token storage is not implemented in this starter yet; do not use this as a production login.", { status: 501, headers: { "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/playback" && request.method === "GET") {
      return json({ error: "Playback endpoint is not wired until encrypted token sessions are implemented." }, 501);
    }

    if (url.pathname === "/auth/logout" && request.method === "POST") {
      return new Response(null, { status: 204, headers: { "set-cookie": "lyric_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
    }

    return env.ASSETS.fetch(request);
  }
};

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  const item = header.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
function randomToken(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
