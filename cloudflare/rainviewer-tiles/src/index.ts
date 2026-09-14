/**
 * Edge-cached RainViewer radar tile proxy for StormPath (web + Capacitor).
 * Same URL shape as web/netlify/functions/rainviewer-tile.ts — swap base URL in the app.
 *
 * Cache key is the tile identity (frame/z/x/y/color/options), so all users share edge cache
 * and public RainViewer rate limits are not hit once per phone.
 */
const TILE_PATH =
  /\/rainviewer-tile(\/v2\/radar\/[A-Za-z0-9._-]+)\/256\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/([0-9_]+)\.png$/i;

const UPSTREAM_HOST = "https://tilecache.rainviewer.com";
const MAX_Z = 7;

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

function cacheKeyForTile(
  framePath: string,
  z: string,
  x: string,
  y: string,
  color: string,
  options: string
): Request {
  return new Request(
    `https://stormpath-rv-tile-cache.internal${framePath}/256/${z}/${x}/${y}/${color}/${options}.png`,
    { method: "GET" }
  );
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
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
        "Expected path: /rainviewer-tile/v2/radar/{frame}/256/{z}/{x}/{y}/{color}/{options}.png",
        { status: 400, headers: { ...CORS, "Content-Type": "text/plain" } }
      );
    }

    const [, framePath, z, x, y, color, options] = match;
    const zNum = Number(z);
    if (!Number.isFinite(zNum) || zNum < 0 || zNum > MAX_Z) {
      return new Response(`RainViewer tiles only support z=0..${MAX_Z}`, {
        status: 400,
        headers: { ...CORS, "Content-Type": "text/plain" },
      });
    }

    const upstreamUrl = `${UPSTREAM_HOST}${framePath}/256/${z}/${x}/${y}/${color}/${options}.png`;
    const cache = caches.default;
    const cacheReq = cacheKeyForTile(framePath!, z!, x!, y!, color!, options!);
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
