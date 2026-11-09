/**
 * StormPath DOT feeds — WZDx work-zone/closure normalizer.
 *
 * Pulls the USDOT Work Zone Data Feed Registry (data.transportation.gov),
 * fetches every open (no-key) state GeoJSON feed, normalizes to one compact
 * schema, and serves /events?bbox=w,s,e,n filtered to the caller's corridor.
 *
 * The merged snapshot lives in the edge Cache API (~4 min) so all users share
 * one upstream poll per PoP — no KV, no cron, self-healing on cold cache.
 * Feeds that need API keys are skipped in v1 (registry `needapikey` rows).
 */

const REGISTRY_URL =
  "https://data.transportation.gov/resource/69qe-yiui.json?$where=active=true&$limit=300";
const SNAPSHOT_CACHE_URL = "https://stormpath-dot-feeds.internal/snapshot";
const SNAPSHOT_MAX_AGE_MS = 4 * 60_000;
/** Keep events that ended recently or start within a week — route planning lookahead. */
const WINDOW_PAST_MS = 12 * 3_600_000;
const WINDOW_FUTURE_MS = 7 * 24 * 3_600_000;
const FEED_TIMEOUT_MS = 12_000;
const MAX_DESCRIPTION_CHARS = 400;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type RegistryRow = {
  state?: string;
  issuingorganization?: string;
  feedname?: string;
  needapikey?: string | boolean;
  url?: { url?: string } | string;
};

type DotEvent = {
  id: string;
  state: string;
  publisher: string;
  kind: "construction" | "closure" | "incident" | "other";
  status: "active" | "scheduled";
  title: string;
  roadName: string;
  direction: string | null;
  description: string;
  restrictionsText: string | null;
  lanesClosed: number;
  vehicleImpact: string | null;
  startIso: string | null;
  endIso: string | null;
  point: [number, number];
  bbox: [number, number, number, number];
  geometry: unknown;
};

type Snapshot = { fetchedAt: number; events: DotEvent[] };

function feedUrlOf(row: RegistryRow): string | null {
  const u = row.url;
  if (typeof u === "string") return u || null;
  return u?.url?.trim() || null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** WZDx v4 nests fields under core_details; older feeds flatten them. */
function coreOf(props: Record<string, unknown>): Record<string, unknown> {
  return { ...props, ...asRecord(props.core_details) };
}

function eventKind(eventType: string): DotEvent["kind"] {
  const t = eventType.toLowerCase();
  if (t.includes("work") || t.includes("construction") || t.includes("maintenance"))
    return "construction";
  if (t.includes("clos")) return "closure";
  if (t.includes("incident") || t.includes("crash") || t.includes("hazard"))
    return "incident";
  return "other";
}

function fmtRestriction(r: Record<string, unknown>): string | null {
  const type = str(r.type).toLowerCase();
  const value = Number(r.value);
  const unit = str(r.unit).toLowerCase();
  if (!type || !Number.isFinite(value) || value <= 0) return null;
  const label =
    type.includes("length")
      ? "Length limit"
      : type.includes("width")
        ? "Width limit"
        : type.includes("weight") || type.includes("load")
          ? "Weight limit"
          : type.includes("speed")
            ? "Speed limit"
            : type.replace(/[-_]+/g, " ");
  let amount: string;
  if (unit === "centimeters" || unit === "cm") amount = `${Math.round(value / 30.48)} ft`;
  else if (unit === "kilograms" || unit === "kg") amount = `${Math.round(value * 2.205)} lb`;
  else if (unit === "meters" || unit === "m") amount = `${(value / 1609.34).toFixed(1)} mi`;
  else amount = `${Math.round(value)} ${unit || ""}`.trim();
  return `${label} ${amount}`;
}

function geometryPoints(geom: unknown): [number, number][] {
  const g = asRecord(geom);
  const coords = g.coordinates;
  const out: [number, number][] = [];
  const walk = (c: unknown, depth: number) => {
    if (depth > 4 || !Array.isArray(c)) return;
    if (typeof c[0] === "number") {
      if (typeof c[0] === "number" && typeof c[1] === "number") out.push([c[0], c[1]]);
      return;
    }
    for (const sub of c) walk(sub, depth + 1);
  };
  walk(coords, 0);
  return out;
}

function normalizeFeature(
  feature: Record<string, unknown>,
  row: RegistryRow,
  nowMs: number
): DotEvent | null {
  const props = asRecord(feature.properties);
  const core = coreOf(props);
  const id = str(feature.id) || str(props.id) || `evt-${Math.random().toString(36).slice(2, 10)}`;

  const startIso = str(props.start_date) || null;
  const endIso = str(props.end_date) || null;
  const startMs = startIso ? Date.parse(startIso) : NaN;
  const endMs = endIso ? Date.parse(endIso) : NaN;
  /* Drop finished work and anything beyond the planning window. */
  if (Number.isFinite(endMs) && endMs < nowMs - WINDOW_PAST_MS) return null;
  if (Number.isFinite(startMs) && startMs > nowMs + WINDOW_FUTURE_MS) return null;

  const points = geometryPoints(feature.geometry);
  if (points.length === 0) return null;

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  let sx = 0, sy = 0;
  for (const [lng, lat] of points) {
    if (lng < w) w = lng;
    if (lat < s) s = lat;
    if (lng > e) e = lng;
    if (lat > n) n = lat;
    sx += lng;
    sy += lat;
  }
  const point: [number, number] = [sx / points.length, sy / points.length];

  const roadNames = asArray<string>(core.road_names).map(str).filter(Boolean);
  const roadName = roadNames[0] ?? "";
  const direction = str(core.direction) || null;
  const rawDesc = str(core.description);
  const description = rawDesc.split(/Full schedule below/i)[0]!.trim().slice(0, MAX_DESCRIPTION_CHARS);

  const lanes = asArray<Record<string, unknown>>(props.lanes ?? core.lanes);
  const lanesClosed = lanes.filter((l) => {
    const st = str(l.status).toLowerCase();
    return st && st !== "open" && st !== "unknown";
  }).length;

  const restrictions = asArray<Record<string, unknown>>(props.restrictions ?? core.restrictions)
    .map(fmtRestriction)
    .filter((t): t is string => Boolean(t));

  const titleParts = [roadName, direction ? direction.replace(/-/g, " ") : ""].filter(Boolean);
  const eventType = str(core.event_type).toLowerCase();
  const kind = eventKind(eventType || "work-zone");
  const status: DotEvent["status"] =
    Number.isFinite(startMs) && startMs > nowMs ? "scheduled" : "active";

  return {
    id: `${row.feedname ?? row.state ?? "feed"}:${id}`,
    state: str(row.state) || "us",
    publisher: str(row.issuingorganization) || "State DOT",
    kind,
    status,
    title: titleParts.join(" · ") || (kind === "construction" ? "Road work" : "Road event"),
    roadName,
    direction,
    description,
    restrictionsText: restrictions.length ? restrictions.join("; ") : null,
    lanesClosed,
    vehicleImpact: str(props.vehicle_impact ?? core.vehicle_impact) || null,
    startIso,
    endIso,
    point,
    bbox: [w, s, e, n],
    geometry: feature.geometry ?? null,
  };
}

async function fetchJson(url: string, timeoutMs = FEED_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "StormPath-DOT-Feeds/1.0 (+https://stormpath.app)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function buildSnapshot(): Promise<Snapshot> {
  const nowMs = Date.now();
  const registry = (await fetchJson(REGISTRY_URL, 15_000)) as RegistryRow[];
  const rows = registry.filter((r) => {
    const keyed = r.needapikey === true || String(r.needapikey).toLowerCase() === "true";
    return !keyed && feedUrlOf(r);
  });

  const events: DotEvent[] = [];
  const results = await Promise.allSettled(
    rows.map(async (row) => {
      const url = feedUrlOf(row);
      if (!url) return;
      const feed = (await fetchJson(url)) as Record<string, unknown>;
      const features = asArray<Record<string, unknown>>(feed.features);
      for (const f of features) {
        const ev = normalizeFeature(f, row, nowMs);
        if (ev) events.push(ev);
      }
    })
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) console.warn(`[dot-feeds] ${failed}/${rows.length} feeds failed`);

  events.sort((a, b) => a.id.localeCompare(b.id));
  return { fetchedAt: nowMs, events };
}

async function snapshot(cachesApi: Cache): Promise<Snapshot | null> {
  const hit = await cachesApi.match(SNAPSHOT_CACHE_URL);
  let snap: Snapshot | null = null;
  if (hit) {
    try {
      snap = (await hit.json()) as Snapshot;
    } catch {
      snap = null;
    }
  }
  const fresh = snap && Date.now() - snap.fetchedAt < SNAPSHOT_MAX_AGE_MS;
  if (fresh) return snap;
  try {
    const next = await buildSnapshot();
    await cachesApi.put(
      SNAPSHOT_CACHE_URL,
      new Response(JSON.stringify(next), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=240" },
      })
    );
    return next;
  } catch (err) {
    console.error("[dot-feeds] snapshot rebuild failed", err);
    return snap; /* serve stale rather than nothing */
  }
}

function bboxIntersects(a: number[], b: number[]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405, headers: CORS });

    if (url.pathname === "/" || url.pathname === "/health") {
      const snap = await snapshot(caches.default);
      return Response.json(
        {
          ok: true,
          events: snap?.events.length ?? 0,
          ageSec: snap ? Math.round((Date.now() - snap.fetchedAt) / 1000) : null,
        },
        { headers: CORS }
      );
    }

    if (url.pathname === "/events") {
      const parts = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
      const snap = await snapshot(caches.default);
      if (!snap) return Response.json({ error: "no snapshot" }, { status: 503, headers: CORS });
      let events = snap.events;
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        const q: [number, number, number, number] = [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
        events = events.filter((e) => bboxIntersects(e.bbox, q));
      }
      /* Geometry stays — the app matches event lines to the route corridor. */
      return Response.json(
        { fetchedAt: snap.fetchedAt, count: events.length, events },
        { headers: { ...CORS, "Cache-Control": "public, max-age=60" } }
      );
    }

    /* Warm the snapshot in the background so the first /events isn't slow. */
    if (url.pathname === "/refresh") {
      ctx.waitUntil(snapshot(caches.default));
      return new Response("refreshing", { status: 202, headers: CORS });
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};
