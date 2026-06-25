/**
 * Edge-cached Tomorrow.io map raster tile proxy for StormPath native (Capacitor).
 * Same URL shape as web/netlify/functions/tomorrow-io-tile.ts — swap base URL in the app.
 *
 * Cache key is tile identity (z/x/y/field/timestamp), not API key, so all users share edge cache.
 */
export interface Env {
  /** Set via `wrangler secret put TOMORROW_IO_API_KEY` — preferred for App Store scale. */
  TOMORROW_IO_API_KEY?: string;
}

const TILE_PATH =
  /\/tomorrow-io-tile\/(\d+)\/(\d+)\/(\d+)\/([^/]+)\/([^/]+)\.png$/i;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_CONTROL_OK = "public, max-age=300, s-maxage=300";

function withCors(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const [k, v] of Object.entries(CORS)) out.set(k, v);
  return out;
}

function cacheKeyForTile(z: string, x: string, y: string, field: string, ts: string): Request {
  return new Request(
    `https://stormpath-tile-cache.internal/${z}/${x}/${y}/${field}/${encodeURIComponent(ts)}.png`,
    { method: "GET" }
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    const match = url.pathname.match(TILE_PATH);
    if (!match) {
      return new Response(
        "Expected path: /tomorrow-io-tile/{z}/{x}/{y}/{field}/{timestamp}.png",
        { status: 400, headers: { ...CORS, "Content-Type": "text/plain" } }
      );
    }

    const apiKey =
      url.searchParams.get("apikey")?.trim() || env.TOMORROW_IO_API_KEY?.trim();
    if (!apiKey) {
      return new Response("Missing apikey query parameter or TOMORROW_IO_API_KEY secret", {
        status: 400,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    const [, z, x, y, field, tsRaw] = match;
    const ts = decodeURIComponent(tsRaw!);
    const upstreamUrl = `https://api.tomorrow.io/v4/map/tile/${z}/${x}/${y}/${field}/${ts}.png?apikey=${encodeURIComponent(apiKey)}`;

    const cache = caches.default;
    const cacheReq = cacheKeyForTile(z!, x!, y!, field!, ts);
    const cached = await cache.match(cacheReq);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: withCors(cached.headers),
      });
    }

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, { method: "GET" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "upstream fetch failed";
      return new Response(msg, {
        status: 502,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    const headers = withCors(new Headers(upstream.headers));
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "image/png");
    headers.set("Cache-Control", upstream.ok ? CACHE_CONTROL_OK : "no-store");

    const response = new Response(upstream.body, { status: upstream.status, headers });
    if (upstream.ok) {
      ctx.waitUntil(cache.put(cacheReq, response.clone()));
    }
    return response;
  },
};
