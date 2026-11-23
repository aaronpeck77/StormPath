/**
 * stormpath-social-x — minimal X (Twitter) posting worker.
 *
 * POST /post              { "text": "..." }   → publishes a tweet
 * POST /forecast-preview                     → returns the composed forecast, no post
 * POST /forecast-post                        → composes and posts the daily forecast
 * GET  /health                               → { ok, configured }
 * Cron 13:00 UTC (8am ET)                    → posts the daily forecast
 *
 * Auth: header `x-social-key: <SOCIAL_POST_KEY>` on every mutating call.
 * X credentials: OAuth 1.0a user-context via wrangler secrets.
 */

import { BRAND_PNG_B64 } from "./brand";
import { decodePng, encodePng, composite, type RgbaImage } from "./pngCodec";

export interface Env {
  X_API_KEY: string;
  X_API_SECRET: string;
  X_ACCESS_TOKEN: string;
  X_ACCESS_SECRET: string;
  SOCIAL_POST_KEY: string;
  MAPBOX_TOKEN: string;
  DOT_FEEDS: Fetcher;
}

const TWEET_URL = "https://api.x.com/2/tweets";
const MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const DOT_EVENTS_URL = "https://stormpath-dot-feeds.psvkzbbmnt.workers.dev/events";
const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?status=actual";

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

async function oauthHeader(
  method: string,
  url: string,
  env: Env,
  extra: Record<string, string> = {}
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
    ...extra,
  };
  const paramStr = Object.keys(oauth)
    .sort()
    .map((k) => `${pct(k)}=${pct(oauth[k]!)}`)
    .join("&");
  const base = `${method}&${pct(url)}&${pct(paramStr)}`;
  const signingKey = `${pct(env.X_API_SECRET)}&${pct(env.X_ACCESS_SECRET)}`;
  oauth.oauth_signature = await hmacSha1(signingKey, base);

  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k]!)}"`)
      .join(", ")
  );
}

async function postTweet(text: string, env: Env, mediaId?: string): Promise<Response> {
  const header = await oauthHeader("POST", TWEET_URL, env);
  const body: Record<string, unknown> = { text };
  if (mediaId) body.media = { media_ids: [mediaId] };
  return fetch(TWEET_URL, {
    method: "POST",
    headers: { Authorization: header, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Upload image bytes → X media id. v1.1 simple upload (<5MB). */
async function uploadMedia(png: ArrayBuffer, env: Env): Promise<string | null> {
  const header = await oauthHeader("POST", MEDIA_UPLOAD_URL, env);
  const form = new FormData();
  form.append("media", new Blob([png], { type: "image/png" }), "map.png");
  const res = await fetch(MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: header },
    body: form,
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { media_id_string?: string };
  return j.media_id_string ?? null;
}

/* ------------------------------------------------------------------ */
/* Forecast composition                                                */
/* ------------------------------------------------------------------ */

/** NWS event names → display bucket. Order matters: first match wins. */
const STORM_BUCKETS: { match: RegExp; label: string }[] = [
  { match: /tornado/i, label: "Tornado" },
  { match: /severe thunderstorm/i, label: "Severe t-storms" },
  { match: /blizzard|ice storm|winter storm|winter weather/i, label: "Winter storm" },
  { match: /flash flood|flood/i, label: "Flooding" },
  { match: /hurricane|tropical storm/i, label: "Tropical" },
  { match: /high wind|extreme wind|wind advisory/i, label: "High wind" },
];

interface NwsAlert {
  properties: {
    event: string;
    severity: string;
    geocode?: { UGC?: string[] };
    areaDesc?: string;
  };
}

interface DotEvent {
  kind: string;
  roadName?: string;
  state?: string;
  title?: string;
}

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

async function stormLines(): Promise<string[]> {
  const res = await fetch(NWS_ALERTS_URL, {
    headers: { "User-Agent": "StormPath daily forecast (contact: stormpath-app)" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: NwsAlert[] };
  const statesByBucket = new Map<string, Set<string>>();
  for (const f of data.features ?? []) {
    const p = f.properties;
    if (!p?.event) continue;
    if (p.severity !== "Extreme" && p.severity !== "Severe") continue;
    const bucket = STORM_BUCKETS.find((b) => b.match.test(p.event));
    if (!bucket) continue;
    const set = statesByBucket.get(bucket.label) ?? new Set<string>();
    for (const ugc of p.geocode?.UGC ?? []) {
      const st = ugc.slice(0, 2);
      if (/^[A-Z]{2}$/.test(st)) set.add(st);
    }
    statesByBucket.set(bucket.label, set);
  }
  return [...statesByBucket.entries()]
    .filter(([, s]) => s.size > 0)
    .map(([label, s]) => `${label}: ${[...s].sort().join(", ")}`);
}

async function closureLine(env: Env): Promise<string | null> {
  const res = await env.DOT_FEEDS.fetch(DOT_EVENTS_URL);
  if (!res.ok) return null;
  const data = (await res.json()) as { events?: DotEvent[] };
  const seen = new Set<string>();
  const closures: string[] = [];
  for (const e of data.events ?? []) {
    if (e.kind !== "closure") continue;
    const road = (e.roadName ?? "").trim();
    if (!road) continue;
    const st = STATE_ABBR[(e.state ?? "").trim().toLowerCase()] ?? "";
    const label = st ? `${road} ${st}` : road;
    if (seen.has(label)) continue;
    seen.add(label);
    // Interstates/major routes first
    if (/^I[-\s]?\d|^US[-\s]?\d/i.test(road)) closures.unshift(label);
    else closures.push(label);
  }
  if (!closures.length) return null;
  const picked = closures.slice(0, 5);
  const extra = closures.length - picked.length;
  return `Closed: ${picked.join(" · ")}${extra > 0 ? ` +${extra} more` : ""}`;
}

/* ---------------- map image ---------------- */

const WORKER_ORIGIN = "https://stormpath-social-x.psvkzbbmnt.workers.dev";
const MAP_IMG_W = 800;
const MAP_IMG_H = 450;

interface NwsFeature {
  properties?: { severity?: string; geocode?: { UGC?: string[] } };
  geometry?: { type: string; coordinates: unknown } | null;
}

function roundCoord(c: number): number {
  return Math.round(c * 1000) / 1000;
}

function simplifyRing(ring: unknown): unknown {
  if (!Array.isArray(ring)) return ring;
  return (ring as number[][])
    .filter((_, i) => i % 4 === 0 || i === ring.length - 1)
    .map((pt) => Array.isArray(pt) ? pt.slice(0, 2).map(roundCoord) : pt);
}

async function severeAlerts(): Promise<NwsFeature[]> {
  const res = await fetch(NWS_ALERTS_URL, {
    headers: { "User-Agent": "StormPath daily forecast (contact: stormpath-app)" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: NwsFeature[] };
  return (data.features ?? []).filter(
    (f) => f.properties?.severity === "Extreme" || f.properties?.severity === "Severe"
  );
}

/** Pick the state with the most severe alerts → focus the map there. */
async function mapFocus(env: Env): Promise<{ geojson: object; hasContent: boolean }> {
  const alerts = await severeAlerts();
  const byState = new Map<string, NwsFeature[]>();
  for (const f of alerts) {
    const st = f.properties?.geocode?.UGC?.[0]?.slice(0, 2) ?? "";
    if (!st) continue;
    byState.set(st, [...(byState.get(st) ?? []), f]);
  }
  const [focusState, focusAlerts] =
    [...byState.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];

  const features: object[] = [];
  let bbox = [180, 90, -180, -90];
  const grow = (lng: number, lat: number) => {
    bbox[0] = Math.min(bbox[0], lng); bbox[1] = Math.min(bbox[1], lat);
    bbox[2] = Math.max(bbox[2], lng); bbox[3] = Math.max(bbox[3], lat);
  };

  // Storm polygons (orange shading) — focus-state alerts first, but zone-based
  // alerts carry no geometry, so fall back to any severe alert with a polygon
  const polySrc = [
    ...(focusAlerts ?? []).filter((f) => f.geometry),
    ...alerts.filter((f) => f.geometry),
  ].slice(0, 4);
  for (const f of polySrc) {
    const g = f.geometry;
    if (!g) continue;
    const polys =
      g.type === "Polygon" ? [g.coordinates] :
      g.type === "MultiPolygon" ? (g.coordinates as unknown[]).slice(0, 3) : [];
    for (const poly of polys) {
      const rings = (poly as unknown[]).map(simplifyRing);
      features.push({
        type: "Feature",
        properties: { fill: "#ff7a1a", "fill-opacity": 0.18, stroke: "#ff7a1a", "stroke-width": 1.5 },
        geometry: { type: "Polygon", coordinates: rings },
      });
      for (const ring of rings as number[][][])
        for (const [lng, lat] of ring) grow(lng, lat);
    }
  }

  // Closure markers in/near the focus region (red dots)
  try {
    const res = await env.DOT_FEEDS.fetch(DOT_EVENTS_URL);
    const data = (await res.json()) as { events?: DotEvent[] };
    const all = (data.events ?? []).filter((e) => e.kind === "closure" && (e as { point?: unknown }).point);
    let near = all.filter(
      (e) => focusState && STATE_ABBR[(e.state ?? "").trim().toLowerCase()] === focusState
    );
    if (near.length < 3) near = all; // focus state quiet → show national closures
    near = near.slice(0, 60);
    for (const e of near) {
      const pt = (e as { point?: [number, number] }).point;
      if (!pt) continue;
      features.push({
        type: "Feature",
        properties: { "marker-color": "#ff4d4d", "marker-size": "small" },
        geometry: { type: "Point", coordinates: [roundCoord(pt[0]), roundCoord(pt[1])] },
      });
      grow(pt[0], pt[1]);
    }
  } catch { /* image without closures is fine */ }

  return { geojson: { type: "FeatureCollection", features }, hasContent: features.length > 0 };
}

/** Google polyline encoding — Mapbox `path-` overlays use this; ~5x smaller
 * than inline GeoJSON. */
function polylineEncode(coords: [number, number][], precision = 5): string {
  let out = "";
  let prevLat = 0, prevLng = 0;
  const factor = 10 ** precision;
  const enc = (v: number) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of coords) {
    const ilat = Math.round(lat * factor), ilng = Math.round(lng * factor);
    enc(ilat - prevLat); enc(ilng - prevLng);
    prevLat = ilat; prevLng = ilng;
  }
  return out;
}

async function buildMapImage(
  env: Env
): Promise<{ png: ArrayBuffer | null; reason: string }> {
  if (!env.MAPBOX_TOKEN) return { png: null, reason: "no mapbox token" };
  const { geojson, hasContent } = await mapFocus(env);
  if (!hasContent) return { png: null, reason: "no features" };

  // Translate the FeatureCollection into compact overlay syntax:
  // polygons → path-stroke+fill-opacity(fill-opacity)(polyline)
  // points   → pin-s-hex(lon,lat)
  const overlays: string[] = [];
  for (const f of (geojson as { features: { properties?: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] }).features) {
    const g = f.geometry;
    if (g.type === "Polygon") {
      const ring = (g.coordinates as number[][][])[0] ?? [];
      const coords = ring.map((p) => [p[0], p[1]] as [number, number]);
      if (coords.length > 2)
        overlays.push(`path-2+ff7a1a-0.9+ff7a1a-0.18(${polylineEncode(coords, 5)})`);
    } else if (g.type === "Point") {
      const [lng, lat] = g.coordinates as number[];
      overlays.push(`pin-s+ff4d4d(${lng.toFixed(3)},${lat.toFixed(3)})`);
    }
  }
  const overlay = encodeURIComponent(overlays.slice(0, 80).join(","));
  if (overlay.length > 7800)
    return { png: null, reason: `overlay too big ${overlay.length}` };
  const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${overlay}/auto/${MAP_IMG_W}x${MAP_IMG_H}?padding=40&access_token=${env.MAPBOX_TOKEN}`;

  const mapRes = await fetch(mapUrl);
  if (!mapRes.ok) return { png: null, reason: `mapbox ${mapRes.status}` };
  const raw = await mapRes.arrayBuffer();

  // Brand lockup composited bottom-left, in-worker (PNG codec in ./pngCodec)
  try {
    const map = await decodePng(new Uint8Array(raw));
    if (!brandImg) {
      const bytes = Uint8Array.from(atob(BRAND_PNG_B64), (c) => c.charCodeAt(0));
      brandImg = await decodePng(bytes);
    }
    // subtle dark pad behind the lockup for legibility over busy map areas
    const pad = 10, bw = brandImg.w + pad * 2, bh = brandImg.h + pad * 2;
    const bx = 6, by = map.h - bh - 6;
    const padImg: RgbaImage = { w: bw, h: bh, data: new Uint8Array(bw * bh * 4) };
    for (let i = 0; i < padImg.data.length; i += 4) {
      padImg.data[i] = 11; padImg.data[i + 1] = 15; padImg.data[i + 2] = 20; padImg.data[i + 3] = 180;
    }
    composite(map, padImg, bx, by);
    composite(map, brandImg, bx + pad, by + pad);
    return { png: (await encodePng(map)).buffer as ArrayBuffer, reason: "ok" };
  } catch (e) {
    return { png: raw, reason: `brand composite failed: ${e}` };
  }
}

let brandImg: RgbaImage | null = null;

function usDate(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
  });
}

const FOOTER = "Weather + hazards along your whole route — free on the App Store.";

async function buildForecast(env: Env): Promise<string> {
  const [storms, closures] = await Promise.all([stormLines(), closureLine(env)]);
  const header = `StormPath Morning Forecast · US · ${usDate()}`;
  const body = [...storms, ...(closures ? [closures] : [])];
  let text: string;
  if (!body.length) {
    text = `${header}\n\nAll clear — no severe storms or major highway closures on US corridors today.\n\n${FOOTER}`;
  } else {
    text = `${header}\n\n${body.join("\n")}\n\n${FOOTER}`;
  }
  // Over 280? Drop closure entries first, then trim the longest storm lines.
  while (text.length > 280 && body.length > 1) {
    body.splice(body.length - 2, 1);
    text = `${header}\n\n${body.join("\n")}\n\n${FOOTER}`;
  }
  if (text.length > 280) text = text.slice(0, 277) + "...";
  return text;
}

/* ------------------------------------------------------------------ */

function configured(env: Env): boolean {
  return Boolean(
    env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET
  );
}

function authorized(req: Request, env: Env): boolean {
  return Boolean(env.SOCIAL_POST_KEY) && req.headers.get("x-social-key") === env.SOCIAL_POST_KEY;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, configured: configured(env) });
    }

    if (url.pathname === "/brand.png") {
      const bin = Uint8Array.from(atob(BRAND_PNG_B64), (c) => c.charCodeAt(0));
      return new Response(bin, {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      });
    }

    if (url.pathname === "/forecast-image-preview") {
      const { png, reason } = await buildMapImage(env);
      if (!png) return Response.json({ image: false, reason }, { status: 404 });
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    }

    if (req.method !== "POST") return new Response("not found", { status: 404 });
    if (!authorized(req, env)) return new Response("unauthorized", { status: 401 });
    if (!configured(env)) {
      return Response.json({ ok: false, error: "X credentials not set" }, { status: 500 });
    }

    if (url.pathname === "/forecast-preview" || url.pathname === "/forecast-post") {
      const text = await buildForecast(env);
      if (url.pathname === "/forecast-preview") {
        return Response.json({ text, chars: text.length });
      }
      const { png } = await buildMapImage(env);
      const mediaId = png ? await uploadMedia(png, env) : null;
      const res = await postTweet(text, env, mediaId ?? undefined);
      return new Response(await res.text(), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname !== "/post") return new Response("not found", { status: 404 });

    let text: string;
    try {
      const body = (await req.json()) as { text?: string };
      text = (body.text ?? "").trim();
    } catch {
      return Response.json({ ok: false, error: "bad json" }, { status: 400 });
    }
    if (!text || text.length > 280) {
      return Response.json({ ok: false, error: "text required, ≤280 chars" }, { status: 400 });
    }

    const res = await postTweet(text, env);
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!configured(env)) return;
    ctx.waitUntil(
      (async () => {
        const text = await buildForecast(env);
        const { png } = await buildMapImage(env);
        const mediaId = png ? await uploadMedia(png, env) : null;
        await postTweet(text, env, mediaId ?? undefined);
      })()
    );
  },
};
