/**
 * stormpath-social-x — minimal X (Twitter) posting worker.
 *
 * POST /post  { "text": "..." }        → publishes a tweet
 * GET  /health                          → { ok, configured }
 *
 * Auth: header `x-social-key: <SOCIAL_POST_KEY>` on every /post call.
 * X credentials come from wrangler secrets (OAuth 1.0a user-context,
 * the app's own account — no login flow needed):
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
 */

export interface Env {
  X_API_KEY: string;
  X_API_SECRET: string;
  X_ACCESS_TOKEN: string;
  X_ACCESS_SECRET: string;
  SOCIAL_POST_KEY: string;
}

const TWEET_URL = "https://api.x.com/2/tweets";

function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function postTweet(text: string, env: Env): Promise<Response> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const paramStr = Object.keys(oauth)
    .sort()
    .map((k) => `${pct(k)}=${pct(oauth[k]!)}`)
    .join("&");
  const base = `POST&${pct(TWEET_URL)}&${pct(paramStr)}`;
  const signingKey = `${pct(env.X_API_SECRET)}&${pct(env.X_ACCESS_SECRET)}`;
  oauth.oauth_signature = await hmacSha1(signingKey, base);

  const header =
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k]!)}"`)
      .join(", ");

  return fetch(TWEET_URL, {
    method: "POST",
    headers: { Authorization: header, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

function configured(env: Env): boolean {
  return Boolean(
    env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET
  );
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, configured: configured(env) });
    }

    if (url.pathname !== "/post" || req.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    if (!env.SOCIAL_POST_KEY || req.headers.get("x-social-key") !== env.SOCIAL_POST_KEY) {
      return new Response("unauthorized", { status: 401 });
    }
    if (!configured(env)) {
      return Response.json({ ok: false, error: "X credentials not set" }, { status: 500 });
    }

    let text: string;
    try {
      const body = (await req.json()) as { text?: string };
      text = (body.text ?? "").trim();
    } catch {
      return Response.json({ ok: false, error: "bad json" }, { status: 400 });
    }
    if (!text || text.length > 280) {
      return Response.json(
        { ok: false, error: "text required, ≤280 chars" },
        { status: 400 }
      );
    }

    const res = await postTweet(text, env);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  },
};
