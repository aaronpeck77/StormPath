/**
 * StormPath DOT feeds — WZDx work-zone/closure normalizer.
 *
 * Pulls the USDOT Work Zone Data Feed Registry (data.transportation.gov),
 * fetches every open (no-key) state GeoJSON feed, normalizes to one compact
 * schema, and serves /events?bbox=w,s,e,n filtered to the caller's corridor.
 *
 * The merged snapshot lives in the edge Cache API (~4 min) so all users share
 * one upstream poll per PoP — no KV, no cron, self-healing on cold cache.
 *
 * Keyed feeds (registry `needapikey` rows — IL, TX, OH, PA, VA, NC, MI, CA,
 * MA, CO, NPS, OR) are supported via per-feed Worker secrets named below.
 * Until a secret is set the feed is skipped, same as before. Set keys with
 * `wrangler secret put <SECRET_NAME>` — never commit them.
 */

const REGISTRY_URL =
  "https://data.transportation.gov/resource/69qe-yiui.json?$where=active=true&$limit=300";
const SNAPSHOT_CACHE_URL = "https://stormpath-dot-feeds.internal/snapshot";
const SNAPSHOT_MAX_AGE_MS = 4 * 60_000;
/** Keep events that ended recently or start within a week — route planning lookahead. */
const WINDOW_PAST_MS = 12 * 3_600_000;
const WINDOW_FUTURE_MS = 7 * 24 * 3_600_000;
const FEED_TIMEOUT_MS = 12_000;
/** Workers cap at 128 MB — parsed feeds are multi-MB each, so process in batches. */
const FEED_BATCH = 4;
const MAX_FEED_BYTES = 15 * 1024 * 1024;
/** Cap retained geometry — some feeds attach full road centerlines per event. */
const SIMPLIFIED_GEOM_POINTS = 50;
const MAX_FEATURES_PER_FEED = 4_000;
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

/** Worker env — secrets arrive as string bindings. */
type FeedEnv = Record<string, string | undefined>;

/**
 * Keyed feeds from the WZDx registry. `param` feeds take the key as a query
 * param (name varies per agency); `header` feeds send it as an HTTP header.
 * Header schemes for mdot/massdot/ncdot/ordot are best-guess — verify each
 * against live data once its key arrives.
 */
const KEYED_FEEDS: Record<
  string,
  { secret: string; param?: string; header?: string; prefix?: string }
> = {
  idot_cwz: { secret: "IDOT_CWZ_API_KEY", param: "api_key" },
  iltollway: { secret: "ILTOLLWAY_API_KEY", param: "api_key" },
  txdot_v4_2: { secret: "TXDOT_API_KEY", param: "key" },
  ohio: { secret: "OHGO_API_KEY", param: "api-key" },
  ptc: { secret: "PENNSTURNPIKE_API_KEY", param: "api_key" },
  vdot: { secret: "VDOT_API_KEY", param: "token" },
  mtc: { secret: "MTC_511_API_KEY", param: "api_key" },
  nps: { secret: "NPS_API_KEY", param: "api_key" },
  cdot: { secret: "CDOT_API_KEY", param: "apiKey" },
  cdot_cwz: { secret: "CDOT_CWZ_API_KEY", param: "apiKey" },
  /* No key in the registry URL — header auth. Schemes to verify per feed. */
  mdot_4: { secret: "MDOT_API_KEY", header: "X-App-Token" }, /* Socrata app token */
  massdot__cwz: { secret: "MASSDOT_CWZ_API_KEY", header: "Authorization", prefix: "Bearer " },
  ncdot: { secret: "NCDOT_API_KEY", header: "Authorization", prefix: "Bearer " },
  ordot: { secret: "ODOT_API_KEY", header: "Ocp-Apim-Subscription-Key" }, /* Azure APIM */
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
  /** Travel lanes (not shoulder/emergency) reported closed — null when the feed
   *  publishes no per-lane status, so the app can fall back to vehicle_impact. */
  travelLanesClosed: number | null;
  /** Short lane-status summary, e.g. "2 lanes closed; shoulder closed". */
  laneSummary: string | null;
  /** First work type from types_of_work, prettified ("Surface work"). */
  workType: string | null;
  vehicleImpact: string | null;
  startIso: string | null;
  endIso: string | null;
  /** Feed's own last-updated stamp — lets the app say "Reported <date>" so a
   * stale or not-yet-started report reads honestly instead of looking live. */
  updatedIso: string | null;
  point: [number, number];
  bbox: [number, number, number, number];
  geometry: unknown;
};

type Snapshot = { fetchedAt: number; events: DotEvent[]; states?: string[] };

function feedUrlOf(row: RegistryRow): string | null {
  const u = row.url;
  if (typeof u === "string") return u || null;
  return u?.url?.trim() || null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** camelCase → snake_case. snake_case keys pass through unchanged. */
function snakeKey(k: string): string {
  return k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * CWZ 1.0 feeds (IDOT, MassDOT, CO) serialize properties camelCase
 * (`coreDetails`, `roadNames`, `eventType`…) while WZDx v4 uses snake_case.
 * Recursively snake_case object keys so both feed shapes hit the same
 * extraction paths. Keys only — values, ids, and coordinates are untouched.
 */
function snakeKeysDeep(v: unknown, depth = 0): unknown {
  if (depth > 6 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => snakeKeysDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[snakeKey(k)] = snakeKeysDeep(val, depth + 1);
  }
  return out;
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

/** IDOT CWZ publishes interstate codes like "I080"; display as "I-80". */
function prettifyRoadName(name: string): string {
  const m = name.match(/^I-?(\d+)$/i);
  return m ? `I-${parseInt(m[1]!, 10)}` : name;
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

/**
 * Sample up to ~200 points from a GeoJSON geometry for bbox/centroid math.
 * Some states attach full road centerlines (100k+ coords) to one work zone —
 * walking every vertex blows the Worker CPU budget. Stride-sampling bounds it.
 */
function sampledPoints(geom: unknown, maxPoints = 200): [number, number][] {
  const g = asRecord(geom);
  const coords = g.coordinates;
  const out: [number, number][] = [];
  const pushPoint = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number")
      out.push([c[0], c[1]]);
  };
  const walk = (c: unknown, depth: number) => {
    if (!Array.isArray(c) || depth > 4) return;
    if (typeof c[0] === "number") {
      pushPoint(c);
      return;
    }
    /* LineString/MultiPoint leaf: stride so huge centerlines stay bounded. */
    if (typeof c[0]?.[0] === "number") {
      const stride = Math.max(1, Math.floor(c.length / maxPoints));
      for (let i = 0; i < c.length && out.length < maxPoints; i += stride) pushPoint(c[i]);
      return;
    }
    for (const sub of c) walk(sub, depth + 1);
  };
  walk(coords, 0);
  return out;
}

/** Downsampled LineString/Point the app uses for corridor matching. */
function simplifiedGeometry(geom: unknown): GeoJSON.Geometry | null {
  const pts = sampledPoints(geom, SIMPLIFIED_GEOM_POINTS);
  if (!pts.length) return null;
  if (pts.length === 1) return { type: "Point", coordinates: pts[0]! };
  return { type: "LineString", coordinates: pts };
}

function normalizeFeature(
  feature: Record<string, unknown>,
  row: RegistryRow,
  nowMs: number
): DotEvent | null {
  /* WZDx wraps fields in `properties`; some CWZ feeds put them on the
   * feature itself. Take whichever is populated, then normalize key casing. */
  const wrapped = asRecord(snakeKeysDeep(feature.properties));
  const props =
    Object.keys(wrapped).length > 0 ? wrapped : asRecord(snakeKeysDeep(feature));
  const core = coreOf(props);
  const geometry = feature.geometry ?? props.geometry;
  const id =
    str(feature.id) ||
    str(props.id) ||
    `evt-${Math.random().toString(36).slice(2, 10)}`;

  const startIso = str(props.start_date) || str(core.start_date) || null;
  const endIso = str(props.end_date) || str(core.end_date) || null;
  /* Feeds disagree on the stamp name: Iowa/Wisconsin publish `update_date`,
   * WZDx-ish feeds use `last_updated(_date)`, CWZ camelCases to the same
   * snake keys after normalization. `creation_date` is the last resort —
   * it is when the event was first reported, still honest "Reported" data. */
  const updatedIso =
    str(props.update_date) ||
    str(core.update_date) ||
    str(props.last_updated) ||
    str(core.last_updated) ||
    str(props.last_updated_date) ||
    str(core.last_updated_date) ||
    str(props.updated) ||
    str(core.updated) ||
    str(props.creation_date) ||
    str(core.creation_date) ||
    null;
  const startMs = startIso ? Date.parse(startIso) : NaN;
  const endMs = endIso ? Date.parse(endIso) : NaN;
  /* Drop finished work and anything beyond the planning window. */
  if (Number.isFinite(endMs) && endMs < nowMs - WINDOW_PAST_MS) return null;
  if (Number.isFinite(startMs) && startMs > nowMs + WINDOW_FUTURE_MS) return null;

  const points = sampledPoints(geometry);
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
  const roadName = prettifyRoadName(roadNames[0] ?? "");
  /* IDOT CWZ uses "unknown" for direction on most events — treat as absent. */
  const dirStr = str(core.direction);
  const direction =
    dirStr && dirStr.toLowerCase() !== "unknown" ? dirStr : null;
  const rawDesc = str(core.description);
  const description = rawDesc.split(/Full schedule below/i)[0]!.trim().slice(0, MAX_DESCRIPTION_CHARS);

  const lanes = asArray<Record<string, unknown>>(props.lanes ?? core.lanes);
  let lanesClosed = 0;
  let travelLanesClosed = 0;
  let shoulderLanesClosed = 0;
  let restrictedLanes = 0;
  for (const l of lanes) {
    const st = str(l.status).toLowerCase();
    if (!st || st === "open" || st === "unknown") continue;
    lanesClosed += 1;
    const type = str(l.type).toLowerCase();
    const isShoulder = type.includes("shoulder");
    const isEmergency = type.includes("emergency");
    if (st.includes("clos")) {
      if (isShoulder) shoulderLanesClosed += 1;
      else if (!isEmergency) travelLanesClosed += 1;
    } else {
      restrictedLanes += 1;
    }
  }
  const laneParts: string[] = [];
  if (travelLanesClosed > 0)
    laneParts.push(
      travelLanesClosed >= 3
        ? "multiple lanes closed"
        : `${travelLanesClosed} lane${travelLanesClosed > 1 ? "s" : ""} closed`
    );
  if (shoulderLanesClosed > 0)
    laneParts.push(
      shoulderLanesClosed > 1 ? "shoulders closed" : "shoulder closed"
    );
  if (restrictedLanes > 0)
    laneParts.push(
      restrictedLanes >= 3
        ? "multiple lanes restricted"
        : `${restrictedLanes} lane${restrictedLanes > 1 ? "s" : ""} restricted`
    );
  const laneSummary = laneParts.length ? laneParts.join("; ") : null;

  const workTypes = [
    ...new Set(
      asArray<Record<string, unknown>>(props.types_of_work ?? core.types_of_work)
        .map((w) => str(w.type_name).replace(/[-_]+/g, " ").trim())
        .filter(Boolean)
    ),
  ].slice(0, 2);
  const workType = workTypes.length
    ? workTypes.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(", ")
    : null;

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
    travelLanesClosed: lanes.length > 0 ? travelLanesClosed : null,
    laneSummary,
    workType,
    vehicleImpact: str(props.vehicle_impact ?? core.vehicle_impact) || null,
    startIso,
    endIso,
    updatedIso,
    point,
    bbox: [w, s, e, n],
    geometry: simplifiedGeometry(geometry),
  };
}

async function fetchJson(
  url: string,
  timeoutMs = FEED_TIMEOUT_MS,
  headers?: Record<string, string>
): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "StormPath-DOT-Feeds/1.0 (+https://stormpath.app)", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_FEED_BYTES) throw new Error(`feed too large (${len} bytes)`);
  /* Chunked responses can lie about size — cap the actual bytes read. */
  if (!res.body) return res.json();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error(`feed too large (> ${MAX_FEED_BYTES} bytes)`);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

function isKeyed(row: RegistryRow): boolean {
  return row.needapikey === true || String(row.needapikey).toLowerCase() === "true";
}

/**
 * Resolve a registry row to a fetchable URL + optional auth headers.
 * Returns null when the feed can't be fetched (keyed with no secret, or a
 * keyed feed we have no auth config for).
 */
function authFor(
  row: RegistryRow,
  env: FeedEnv
): { url: string; headers?: Record<string, string> } | null {
  const url = feedUrlOf(row);
  if (!url) return null;
  if (!isKeyed(row)) return { url };
  const cfg = KEYED_FEEDS[row.feedname ?? ""];
  if (!cfg) return null;
  const key = env[cfg.secret];
  if (!key) return null;
  let finalUrl = url;
  if (cfg.param) {
    const u = new URL(url);
    u.searchParams.set(cfg.param, key);
    finalUrl = u.toString();
  }
  const headers = cfg.header
    ? { [cfg.header]: `${cfg.prefix ?? ""}${key}` }
    : undefined;
  return { url: finalUrl, headers };
}

/** Registry state labels → comparable lowercase names; regional feeds split on ",". */
function stateNamesOf(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 1 && s !== "n/a" && s !== "us" && s !== "nps");
}

async function buildSnapshot(env: FeedEnv): Promise<Snapshot> {
  const nowMs = Date.now();
  const registry = (await fetchJson(REGISTRY_URL, 15_000)) as RegistryRow[];
  const rows = registry.filter((r) => feedUrlOf(r));

  const events: DotEvent[] = [];
  const coveredStates = new Set<string>();
  let failed = 0;
  let skippedKeyed = 0;
  /* Sequential batches — holding ~30 parsed GeoJSON feeds at once exceeds
   * the 128 MB isolate limit. Batches of 4 keep peak memory ~40 MB. */
  for (let i = 0; i < rows.length; i += FEED_BATCH) {
    const batch = rows.slice(i, i + FEED_BATCH);
    await Promise.all(
      batch.map(async (row) => {
        const auth = authFor(row, env);
        if (!auth) {
          if (isKeyed(row)) skippedKeyed += 1;
          return;
        }
        try {
          const feed = (await fetchJson(auth.url, FEED_TIMEOUT_MS, auth.headers)) as Record<
            string,
            unknown
          >;
          /* Feed fetched — the state counts as covered even with zero events
           * right now (coverage ≠ active work zones). */
          for (const s of stateNamesOf(row.state)) coveredStates.add(s);
          /* FeatureCollection (`features`) is the WZDx shape; some CWZ feeds
           * expose a bare `road_events` array instead. */
          const fc = asArray<Record<string, unknown>>(feed.features);
          const list = fc.length
            ? fc
            : asArray<Record<string, unknown>>(feed.road_events);
          const features = list.slice(0, MAX_FEATURES_PER_FEED);
          for (const f of features) {
            const ev = normalizeFeature(f, row, nowMs);
            if (ev) events.push(ev);
          }
        } catch (err) {
          failed += 1;
          console.warn(`[dot-feeds] feed failed: ${row.feedname ?? auth.url}`, err);
        }
      })
    );
  }
  if (skippedKeyed > 0)
    console.warn(`[dot-feeds] ${skippedKeyed} keyed feeds skipped (no secret configured)`);
  if (failed > 0) console.warn(`[dot-feeds] ${failed}/${rows.length} feeds failed`);

  events.sort((a, b) => a.id.localeCompare(b.id));
  return { fetchedAt: nowMs, events, states: [...coveredStates].sort() };
}

async function snapshot(cachesApi: Cache, env: FeedEnv): Promise<Snapshot | null> {
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
    const next = await buildSnapshot(env);
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
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const bindings = (env ?? {}) as FeedEnv;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405, headers: CORS });

    if (url.pathname === "/" || url.pathname === "/health") {
      const snap = await snapshot(caches.default, bindings);
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
      const snap = await snapshot(caches.default, bindings);
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

    /* States/jurisdictions with a live feed — lets the app say honestly when
     * a driver is somewhere we have no DOT data instead of implying "all clear". */
    if (url.pathname === "/coverage") {
      const snap = await snapshot(caches.default, bindings);
      if (!snap) return Response.json({ error: "no snapshot" }, { status: 503, headers: CORS });
      const states =
        snap.states ??
        [...new Set(snap.events.map((e) => e.state.trim().toLowerCase()))].sort();
      return Response.json(
        { fetchedAt: snap.fetchedAt, states },
        { headers: { ...CORS, "Cache-Control": "public, max-age=300" } }
      );
    }

    /* Warm the snapshot in the background so the first /events isn't slow. */
    if (url.pathname === "/refresh") {
      ctx.waitUntil(snapshot(caches.default, bindings));
      return new Response("refreshing", { status: 202, headers: CORS });
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};
