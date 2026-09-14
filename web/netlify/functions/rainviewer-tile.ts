/**
 * Proxies RainViewer radar tiles with CORS + Cache-Control so many phones share
 * one origin fetch (public RainViewer rate limits otherwise shut the overlay off).
 *
 * Path shape mirrors tilecache.rainviewer.com:
 *   /rainviewer-tile/v2/radar/{frame}/256/{z}/{x}/{y}/{color}/{options}.png
 */
type NetlifyHandler = (event: {
  httpMethod: string;
  path: string;
  rawQuery?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}) => Promise<{
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const UPSTREAM_HOST = "https://tilecache.rainviewer.com";

/** Frame path + tile coords — reject open-proxy abuse. */
const TILE_PATH =
  /(?:\/\.netlify\/functions)?\/rainviewer-tile(\/v2\/radar\/[A-Za-z0-9._-]+)\/256\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/([0-9_]+)\.png$/i;

const MAX_Z = 7;

export const handler: NetlifyHandler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: "Method not allowed" };
  }

  const match = event.path.match(TILE_PATH);
  if (!match) {
    /* Ops / deploy smoke: function is live even without a tile path. */
    if (/rainviewer-tile\/?$/i.test(event.path) || /rainviewer-tile$/i.test(event.path)) {
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "text/plain" },
        body: "ok",
      };
    }
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "text/plain" },
      body: "Expected path: /rainviewer-tile/v2/radar/{frame}/256/{z}/{x}/{y}/{color}/{options}.png",
    };
  }

  const [, framePath, z, x, y, color, options] = match;
  const zNum = Number(z);
  if (!Number.isFinite(zNum) || zNum < 0 || zNum > MAX_Z) {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "text/plain" },
      body: `RainViewer tiles only support z=0..${MAX_Z}`,
    };
  }

  const upstream = `${UPSTREAM_HOST}${framePath}/256/${z}/${x}/${y}/${color}/${options}.png`;

  try {
    const res = await fetch(upstream, { method: "GET" });
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/png";
    return {
      statusCode: res.status,
      headers: {
        ...CORS,
        "Content-Type": contentType,
        /* Frames refresh ~10 min — 5 min edge/browser cache shares load across users. */
        "Cache-Control": res.ok ? "public, max-age=300, s-maxage=300" : "no-store",
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upstream fetch failed";
    return {
      statusCode: 502,
      headers: { ...CORS, "Content-Type": "text/plain" },
      body: msg,
    };
  }
};
