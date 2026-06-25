/**
 * Proxies Tomorrow.io map raster tiles with CORS headers so Capacitor WKWebView / Mapbox GL
 * can load them (direct api.tomorrow.io is blocked by WebView CORS).
 *
 * Optional Netlify env: TOMORROW_IO_API_KEY — when set, clients may omit ?apikey=.
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

const TILE_PATH =
  /\/tomorrow-io-tile\/(\d+)\/(\d+)\/(\d+)\/([^/]+)\/([^/]+)\.png$/i;

function resolveApiKey(
  query: Record<string, string | undefined> | null | undefined
): string | null {
  const fromQuery = query?.apikey?.trim();
  if (fromQuery) return fromQuery;
  const fromEnv = process.env.TOMORROW_IO_API_KEY?.trim();
  return fromEnv || null;
}

export const handler: NetlifyHandler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: "Method not allowed" };
  }

  const match = event.path.match(TILE_PATH);
  if (!match) {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "text/plain" },
      body: "Expected path: /tomorrow-io-tile/{z}/{x}/{y}/{field}/{timestamp}.png",
    };
  }

  const apiKey = resolveApiKey(event.queryStringParameters);
  if (!apiKey) {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "text/plain" },
      body: "Missing apikey query parameter",
    };
  }

  const [, z, x, y, field, tsRaw] = match;
  const ts = decodeURIComponent(tsRaw!);
  const upstream = `https://api.tomorrow.io/v4/map/tile/${z}/${x}/${y}/${field}/${ts}.png?apikey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(upstream, { method: "GET" });
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/png";
    return {
      statusCode: res.status,
      headers: {
        ...CORS,
        "Content-Type": contentType,
        "Cache-Control": res.ok ? "public, max-age=300" : "no-store",
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
