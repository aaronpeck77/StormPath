/**
 * StormPath DOT feeds — WZDx work-zone/closure normalizer.
 *
 * Pulls the USDOT Work Zone Data Feed Registry (data.transportation.gov),
 * fetches every open (no-key) state GeoJSON feed, normalizes to one compact
 * schema, and serves /events?bbox=w,s,e,n filtered to the caller's corridor.
 *
 * The merged snapshot is built OFF-worker: a GitHub Action runs the same
 * buildSnapshot() in Node (no CPU cap) on a schedule and POSTs the result to
 * /ingest, which stores it in the edge Cache API. Requests only ever read
 * the cache — the free plan's 10 ms CPU limit cannot parse ~35 feeds inline.
 *
 * Keyed feeds (registry `needapikey` rows — IL, TX, OH, PA, VA, NC, MI, CA,
 * MA, CO, NPS, OR) are supported via per-feed secrets named below. The Action
 * needs the same names as GitHub secrets; until a secret exists the feed is
 * skipped, same as before. Never commit keys.
 */

const REGISTRY_URL =
  "https://data.transportation.gov/resource/69qe-yiui.json?$where=active=true&$limit=300";
const SNAPSHOT_CACHE_URL = "https://stormpath-dot-feeds.internal/snapshot";
const SNAPSHOT_KV_KEY = "snapshot";
/** Keep events that ended recently or start within a week — route planning lookahead. */
const WINDOW_PAST_MS = 12 * 3_600_000;
const WINDOW_FUTURE_MS = 7 * 24 * 3_600_000;
const FEED_TIMEOUT_MS = 12_000;
/** Workers cap at 128 MB — parsed feeds are multi-MB each, so process in batches. */
const FEED_BATCH = 4;
const MAX_FEED_BYTES = 15 * 1024 * 1024;
/** Cap retained geometry — some feeds attach full road centerlines per event.
 *  The app only ever samples 8 vertices per event (MAX_EVENT_SAMPLE_POINTS),
 *  so 20 is already generous; 50 was ~6× the usable detail and pushed the
 *  snapshot past the KV 25 MiB value limit once NC/MA volume landed. */
const SIMPLIFIED_GEOM_POINTS = 20;
const MAX_FEATURES_PER_FEED = 4_000;
const MAX_DESCRIPTION_CHARS = 400;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type RegistryRow = {
  state?: string;
  issuingorganization?: string;
  feedname?: string;
  needapikey?: string | boolean;
  url?: { url?: string } | string;
};

/** Worker env — secrets arrive as string bindings; SNAPSHOTS is the KV namespace. */
type SnapshotStore = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
};
type FeedEnv = Record<string, string | undefined> & { SNAPSHOTS?: SnapshotStore };

/**
 * Keyed feeds from the WZDx registry. `param` feeds take the key as a query
 * param (name varies per agency); `header` feeds send it as an HTTP header.
 * Header schemes for mdot/massdot/ncdot/ordot are best-guess — verify each
 * against live data once its key arrives.
 */
const KEYED_FEEDS: Record<
  string,
  { secret: string; param?: string; header?: string; prefix?: string; url?: string }
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
  /* url override: registry caps at limit=200 but MI carries ~350 active
   * work zones — without this we'd silently drop ~40% of the state. */
  mdot_4: {
    secret: "MDOT_API_KEY",
    header: "api_key",
    url: "https://mdotridedata.state.mi.us/api/v1/organization/michigan_department_of_transportation/dataset/work_zone_information/query?limit=1000&_format=json",
  },
  massdot__cwz: { secret: "MASSDOT_CWZ_API_KEY", header: "Authorization", prefix: "Bearer " },
  ncdot: { secret: "NCDOT_API_KEY", param: "key" }, /* drivenc.gov docs: query-string 'key' param */
  ordot: { secret: "ODOT_API_KEY", header: "Ocp-Apim-Subscription-Key" }, /* Azure APIM */
};

type DotEvent = {
  id: string;
  state: string;
  publisher: string;
  kind: "construction" | "closure" | "incident" | "condition" | "other";
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

/** Per-feed outcome for the current snapshot — powers /health and the ops
 * page's "which source is down" view. `skipped` = keyed feed with no secret
 * (awaiting signup), not a failure. */
export type FeedStatus = {
  name: string;
  source: "registry" | "custom";
  state: "ok" | "failed" | "skipped";
  events: number;
  error?: string;
  /** Consecutive snapshots this feed has failed, merged across /ingest
   * pushes. 1 = this run only (likely transient); >=2 = sustained outage
   * worth alerting on. */
  failStreak?: number;
};

type Snapshot = {
  fetchedAt: number;
  events: DotEvent[];
  states?: string[];
  feeds?: FeedStatus[];
};

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
  const interstate = name.match(/^I-?(\d+)$/i);
  if (interstate) return `I-${parseInt(interstate[1]!, 10)}`;
  /* TxDOT WZDx publishes internal location codes (IH0030, US0059, FM1957,
   * BI0020E…). Decode the known prefixes so hazard rows read "I-30" not
   * "IH0030". Trailing letters are variant/direction marks — kept. */
  const tx = name.match(/^(IH|US|SH|SL|SS|FM|RM|BI|BU)(\d+)([A-Z])?$/i);
  if (tx) {
    const kind = tx[1]!.toUpperCase();
    const num = parseInt(tx[2]!, 10);
    const suffix = tx[3] ? ` ${tx[3]}` : "";
    switch (kind) {
      case "IH": return `I-${num}${suffix}`;
      case "US": return `US-${num}${suffix}`;
      case "SH": return `SH ${num}${suffix}`;
      case "SL": return `Loop ${num}${suffix}`;
      case "SS": return `Spur ${num}${suffix}`;
      case "FM": return `FM ${num}${suffix}`;
      case "RM": return `RM ${num}${suffix}`;
      case "BI": return `Business I-${num}${suffix}`;
      case "BU": return `Business US-${num}${suffix}`;
    }
  }
  return name;
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
  const cfg = KEYED_FEEDS[row.feedname ?? ""];
  const url = cfg?.url ?? feedUrlOf(row);
  if (!url) return null;
  if (!isKeyed(row)) return { url };
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

/* ── Custom feeds (not in the WZDx registry) ────────────────────────────────
 * State condition feeds the registry doesn't carry. Same DotEvent schema and
 * snapshot; each gets its own normalizer. Add new states here as adapters land.
 */

type CustomFeed = {
  name: string;
  state: string;
  publisher: string;
  url: string;
  normalize: (feature: Record<string, unknown>) => DotEvent | null;
  /** Non-GeoJSON payloads (e.g. CHART's `{data:[...]}`) — defaults to `features`. */
  pick?: (data: Record<string, unknown>) => Record<string, unknown>[];
};

/** Illinois DOT winter road conditions — plow-crew reported segments.
 *  Keyless ArcGIS FeatureServer; f=geojson + outSR=4326 gives WGS84 LineStrings.
 *  Only non-Clear segments become events — "Clear" is the default state and
 *  emitting ~400 clear segments would paint the whole state as a hazard. */
const IL_WINTER_URL =
  "https://services7.arcgis.com/mdhzdIvz6eXVRvAt/ArcGIS/rest/services/" +
  "IL_DOT_Winter_Road_Conditions___3411962229211774331/FeatureServer/0/query" +
  "?where=1%3D1&outFields=FID%2CWrcMntSect%2CCOUNTY_NAM%2CSTR_STATEC%2CCondition" +
  "&f=geojson&outSR=4326&resultRecordCount=2000";

/** STR_STATEC is a zero-padded route number ("016" → IL-16). */
function ilWinterRoadName(code: string): string {
  const n = parseInt(code, 10);
  return Number.isFinite(n) && n > 0 && String(n).length <= 3 ? `IL-${n}` : code;
}

/** Centroid + bbox + downsampled geometry for one feature — shared by the
 *  custom condition normalizers (IL, IA). */
function eventGeo(geometry: unknown): {
  point: [number, number];
  bbox: [number, number, number, number];
  geometry: GeoJSON.Geometry | null;
} | null {
  const points = sampledPoints(geometry);
  if (!points.length) return null;
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
  return {
    point: [sx / points.length, sy / points.length],
    bbox: [w, s, e, n],
    geometry: simplifiedGeometry(geometry),
  };
}

function normalizeIllinoisWinter(feature: Record<string, unknown>): DotEvent | null {
  const props = asRecord(feature.properties);
  const condition = str(props.Condition);
  if (!condition || condition.toLowerCase() === "clear") return null;
  const geo = eventGeo(feature.geometry);
  if (!geo) return null;

  const roadName = ilWinterRoadName(str(props.STR_STATEC));
  const county = str(props.COUNTY_NAM);
  const section = str(props.WrcMntSect).replace(/\s*\((I+)\)\s*$/, "").trim();
  const conditionLabel = condition.replace(/\s+/g, " ").trim();
  /* vehicleImpact carries a condition slug the app maps to severity —
   * ice/full coverage is serious, partial coverage is caution. */
  const impactSlug = conditionLabel.toLowerCase().replace(/\s+/g, "-");

  /* f=geojson returns FID as a number — String() it for a stable id. */
  const fid = props.FID ?? feature.id;
  return {
    id: `ilwinter:${fid != null ? String(fid) : Math.random().toString(36).slice(2, 10)}`,
    state: "illinois",
    publisher: "Illinois DOT",
    kind: "condition",
    status: "active",
    title: roadName,
    roadName,
    direction: null,
    description:
      `${conditionLabel} — ${county ? `${county} County` : "Illinois"}` +
      (section ? ` · IDOT winter maintenance: ${section}` : ""),
    restrictionsText: null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: conditionLabel,
    vehicleImpact: impactSlug,
    startIso: null,
    endIso: null,
    updatedIso: null,
    point: geo.point,
    bbox: geo.bbox,
    geometry: geo.geometry,
  };
}

/** Iowa DOT winter road conditions — plow-reported segments on Iowa DOT's
 *  public ArcGIS org (iowadot.gov documents the services as keyless).
 *  ROAD_CONDITION values per the layer's own renderer: Seasonal (baseline),
 *  Partially Covered, Completely Covered, Travel Not Advised, Impassable.
 *  The server-side where keeps the payload to non-baseline segments only;
 *  the normalizer re-checks defensively. */
const IA_WINTER_URL =
  "https://services.arcgis.com/8lRhdTsQyJpO52F1/ArcGIS/rest/services/" +
  "511_IA_Road_Conditions_View/FeatureServer/0/query" +
  "?where=ROAD_CONDITION%3C%3E%27Seasonal%27" +
  "&outFields=OBJECTID%2CSEGMENT_ID%2CROUTE_NAME%2CLONG_NAME%2CROAD_CONDITION%2CCARS_MSG_UPDATE_DATE" +
  "&f=geojson&outSR=4326&resultRecordCount=2000";

function normalizeIowaWinter(feature: Record<string, unknown>): DotEvent | null {
  const props = asRecord(feature.properties);
  const condition = str(props.ROAD_CONDITION);
  if (!condition || condition.toLowerCase() === "seasonal") return null;
  const geo = eventGeo(feature.geometry);
  if (!geo) return null;

  const roadName = prettifyRoadName(str(props.ROUTE_NAME));
  const conditionLabel = condition.replace(/\s+/g, " ").trim();
  /* LONG_NAME reads "I-235, between Exit 122 … and Exit 4 …" — strip the
   * leading route tag so the detail doesn't repeat roadName. */
  const longName = str(props.LONG_NAME);
  const loc =
    roadName && longName.toLowerCase().startsWith(`${roadName.toLowerCase()},`)
      ? longName.slice(roadName.length + 1).trim()
      : longName;
  /* CARS_MSG_UPDATE_DATE is epoch ms — the feed's honest "Reported" stamp. */
  const updatedMs = Number(props.CARS_MSG_UPDATE_DATE);
  const updatedIso =
    Number.isFinite(updatedMs) && updatedMs > 0
      ? new Date(updatedMs).toISOString()
      : null;
  const sid = props.OBJECTID ?? props.SEGMENT_ID ?? feature.id;

  return {
    id: `iawinter:${sid != null ? String(sid) : Math.random().toString(36).slice(2, 10)}`,
    state: "iowa",
    publisher: "Iowa DOT",
    kind: "condition",
    status: "active",
    title: roadName,
    roadName,
    direction: null,
    description:
      `${conditionLabel} — Iowa DOT winter report` +
      (loc ? ` · ${loc.slice(0, 200)}` : ""),
    restrictionsText: null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: conditionLabel,
    vehicleImpact: conditionLabel.toLowerCase().replace(/\s+/g, "-"),
    startIso: null,
    endIso: null,
    updatedIso,
    point: geo.point,
    bbox: geo.bbox,
    geometry: geo.geometry,
  };
}

/** Missouri DOT winter road conditions — MoDOT TravelerInformation ArcGIS
 *  MapServer layer 26 ("Winter Road Conditions"). Keyless; plow-reported
 *  polylines. ROAD_COND_CODE legend: CLEAR / MOSTLY CLEAR / PARTLY COVERED /
 *  COVERED — the where clause keeps only non-clear segments; the normalizer
 *  re-checks defensively. No road-name field exists — segments are anonymous
 *  geometry, same as MoDOT's own traveler map renders them. */
const MO_WINTER_URL =
  "https://mapping.modot.org/arcgis/rest/services/TravelerInformation/" +
  "TravelerInformationMod/MapServer/26/query" +
  "?where=UPPER%28ROAD_COND_CODE%29%20NOT%20IN%20%28%27CLEAR%27%2C%27MOSTLY%20CLEAR%27%29" +
  "&outFields=ROAD_COND_CODE%2CLEVEL_NO%2CDATA_ID%2COBJECT_ID" +
  "&f=geojson&outSR=4326&resultRecordCount=2000";

function normalizeMissouriWinter(feature: Record<string, unknown>): DotEvent | null {
  const props = asRecord(feature.properties);
  const condition = str(props.ROAD_COND_CODE);
  /* "MOSTLY CLEAR" still contains "clear" — both near-baseline codes drop. */
  if (!condition || condition.toLowerCase().includes("clear")) return null;
  const geo = eventGeo(feature.geometry);
  if (!geo) return null;

  const conditionLabel = condition.replace(/\s+/g, " ").trim();
  /* MoDOT's bare "COVERED" means fully snow/ice covered — emit the slug the
   * app's severity map reads as serious ("completely-covered"). */
  const lc = conditionLabel.toLowerCase();
  const impactSlug =
    lc === "covered" || lc.includes("completely covered")
      ? "completely-covered"
      : lc.includes("part")
        ? "partially-covered"
        : conditionLabel.toLowerCase().replace(/\s+/g, "-");
  const sid = props.OBJECT_ID ?? props.DATA_ID ?? feature.id;

  return {
    id: `mowinter:${sid != null ? String(sid) : Math.random().toString(36).slice(2, 10)}`,
    state: "missouri",
    publisher: "Missouri DOT",
    kind: "condition",
    status: "active",
    title: "Winter road condition",
    roadName: "",
    direction: null,
    description: `${conditionLabel} — Missouri DOT winter road conditions`,
    restrictionsText: null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: conditionLabel,
    vehicleImpact: impactSlug,
    startIso: null,
    endIso: null,
    updatedIso: null,
    point: geo.point,
    bbox: geo.bbox,
    geometry: geo.geometry,
  };
}

/** Maryland CHART — keyless JSONP-turned-JSON export service. Winter-relevant
 *  events carry incidentTypes like "Weather Closure Winter Precipitation";
 *  the feed also carries ordinary incidents/closures, but MD's WZDx `mdot`
 *  feed already covers those — we keep only winter/ice/snow so the two
 *  sources don't double-paint the same crash. Both the incidents and the
 *  active-closures endpoints are wired; whichever carries a winter event
 *  gets through. */
const MD_CHART_INCIDENTS_URL =
  "https://chartexp1.sha.maryland.gov/CHARTExportClientService/getEventMapDataJSON.do";
const MD_CHART_CLOSURES_URL =
  "https://chartexp1.sha.maryland.gov/CHARTExportClientService/getActiveClosureMapDataJSON.do";

function pickChartData(data: Record<string, unknown>): Record<string, unknown>[] {
  return asArray<Record<string, unknown>>(data.data);
}

function normalizeMdChartWinter(event: Record<string, unknown>): DotEvent | null {
  const incidentType = str(event.incidentType);
  /* Winter scope only — "Weather Closure High Water" etc. are real hazards
   * but not winter conditions; they stay out of the winter category. */
  if (!/winter|ice|snow/i.test(incidentType)) return null;
  if (event.closed === true || event.trafficAlert === true) return null;
  const lat = Number(event.lat);
  const lon = Number(event.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const county = str(event.county);
  const direction = str(event.direction) || null;
  const desc = str(event.description);
  /* description reads "Winter Closure @ I-95 @ EXIT 42 …" — keep the feed's
   * own wording; it already names the road and landmark. */
  const label = incidentType.replace(/\s+/g, " ").trim() || "Winter condition";
  const updatedMs = Number(event.lastCachedDataUpdateTime ?? event.createTime);
  const updatedIso =
    Number.isFinite(updatedMs) && updatedMs > 0 ? new Date(updatedMs).toISOString() : null;
  /* Point events: degenerate bbox still intersects the corridor query box. */
  const point: [number, number] = [lon, lat];
  const id = str(event.id) || `${lat},${lon}`;

  return {
    id: `mdchart:${id}`,
    state: "maryland",
    publisher: "Maryland DOT CHART",
    kind: "condition",
    status: "active",
    title: "Winter road condition",
    roadName: "",
    direction,
    description:
      `${label} — ${county ? `${county} County` : "Maryland"}` +
      (desc && !desc.toLowerCase().startsWith(label.toLowerCase()) ? ` · ${desc.slice(0, 160)}` : ""),
    restrictionsText: null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: label,
    vehicleImpact: label.toLowerCase().replace(/\s+/g, "-"),
    startIso: null,
    endIso: null,
    updatedIso,
    point,
    bbox: [lon, lat, lon, lat],
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

/* ── IBI/CARS 511 hosts ────────────────────────────────────────────────────
 * prod-*.ibi511.com deployments share one platform: a public DataTables list
 * feed (/List/GetData/{collection}) plus bulk point geometry
 * (/map/mapIcons/{layerName}) — no API key. Verified keyless 2026-11: UT, WI,
 * AK, GA, AZ, ID, NV, FL. Gotchas found while probing: prod-ne is the
 * *Northeast* region (NH/VT/ME — already covered by necdot WZDx, skipped),
 * LA's hostname doesn't resolve, NY 503s, CT's feed is empty and
 * license-restricted. */
const IBI_HOSTS: {
  host: string;
  state: string;
  publisher: string;
  tag: string;
  /** Collections to skip — WI/ID already have rich WZDx construction feeds
   *  (wisdot/iddot); their IBI Construction lists are the same work zones
   *  mirrored, so we keep only the incidents/closures WZDx lacks. */
  skip?: string[];
}[] = [
  { host: "prod-ut.ibi511.com", state: "utah", publisher: "Utah DOT 511", tag: "ut" },
  { host: "prod-wi.ibi511.com", state: "wisconsin", publisher: "Wisconsin DOT 511", tag: "wi", skip: ["Construction"] },
  { host: "prod-ak.ibi511.com", state: "alaska", publisher: "Alaska DOT 511", tag: "ak" },
  { host: "prod-ga.ibi511.com", state: "georgia", publisher: "Georgia DOT 511", tag: "ga" },
  { host: "prod-az.ibi511.com", state: "arizona", publisher: "Arizona DOT 511", tag: "az" },
  { host: "prod-id.ibi511.com", state: "idaho", publisher: "Idaho DOT 511", tag: "id", skip: ["Construction"] },
  { host: "prod-nv.ibi511.com", state: "nevada", publisher: "Nevada DOT 511", tag: "nv" },
  /* FL's fdot WZDx feed is partial — IBI adds incidents + closures; its
   * Construction list mirrors the same work zones, so it's skipped. */
  { host: "prod-fl.ibi511.com", state: "florida", publisher: "Florida DOT 511", tag: "fl", skip: ["Construction"] },
];
const IBI_COLLECTIONS = ["Construction", "Incidents", "Closures"] as const;
const IBI_PAGE = 1000;
const IBI_MAX_PAGES = 10;

/** Paged DataTables list feed. Empty body = empty collection (not an error);
 * non-JSON body = host shell/ outage (NY's 503) → throw so it shows as failed. */
async function fetchIbiList(
  host: string,
  collection: string
): Promise<Record<string, unknown>[]> {
  const base = host.startsWith("http") ? host : `https://${host}`;
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < IBI_MAX_PAGES; page++) {
    const body = new URLSearchParams({
      start: String(page * IBI_PAGE),
      length: String(IBI_PAGE),
    });
    const res = await fetch(`${base}/List/GetData/${collection}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "StormPath-DOT-Feeds/1.0 (+https://stormpath.app)",
      },
      body,
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 8_000_000) throw new Error("list feed too large");
    if (!text.trim()) return out;
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
      throw new Error("non-JSON response (host shell?)");
    const j = JSON.parse(text) as {
      data?: unknown;
      recordsFiltered?: number;
      recordsTotal?: number;
    };
    const data = asArray<Record<string, unknown>>(j.data);
    out.push(...data);
    const total = Number(j.recordsFiltered ?? j.recordsTotal ?? data.length);
    if (data.length < IBI_PAGE || out.length >= total) break;
  }
  return out;
}

/** Bulk point geometry: {item2:[{itemId, location:[lat,lng]}]} keyed by record id. */
async function fetchIbiIcons(
  host: string,
  layer: string
): Promise<Map<string, [number, number]>> {
  const map = new Map<string, [number, number]>();
  const base = host.startsWith("http") ? host : `https://${host}`;
  const j = (await fetchJson(`${base}/map/mapIcons/${layer}`, FEED_TIMEOUT_MS)) as {
    item2?: { itemId?: unknown; location?: unknown }[];
  };
  for (const it of asArray(j.item2)) {
    const loc = it.location;
    if (!Array.isArray(loc) || loc.length < 2) continue;
    const lat = Number(loc[0]);
    const lng = Number(loc[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    map.set(String(it.itemId), [lng, lat]);
  }
  return map;
}

/** "3/17/25, 12:00 AM" → epoch ms (2-digit years are 20xx). */
function parseIbiDate(raw: string): number | null {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?/i);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  let hour = Number(m[4]) % 24;
  const ap = m[6]?.toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  const ms = Date.UTC(year, Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]));
  return Number.isFinite(ms) ? ms : null;
}

function stripIbiHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " · ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const IBI_DIRECTION: Record<string, string> = {
  northbound: "NB", southbound: "SB", eastbound: "EB", westbound: "WB",
  nb: "NB", sb: "SB", eb: "EB", wb: "WB",
};

/** laneDescription → {vehicleImpact slug, lanesClosed}. "All lanes closed."
 * is the avoid signal; a bare count is serious via some-lanes-closed. */
function ibiLaneImpact(lane: string, isFullClosure: boolean): {
  impact: string | null;
  lanesClosed: number;
} {
  const t = lane.toLowerCase();
  if (/all lanes|both directions|full closure/.test(t) || (isFullClosure && /closed/.test(t)))
    return { impact: "all-lanes-closed", lanesClosed: 0 };
  const n = lane.match(/(\d+)\s*lane/i);
  if (n) return { impact: "some-lanes-closed", lanesClosed: Number(n[1]) };
  if (isFullClosure) return { impact: "all-lanes-closed", lanesClosed: 0 };
  if (/closed|restriction/.test(t)) return { impact: "some-lanes-closed", lanesClosed: 0 };
  return { impact: null, lanesClosed: 0 };
}

const IBI_KIND: Record<string, DotEvent["kind"]> = {
  Construction: "construction",
  Incidents: "incident",
  Closures: "closure",
};

function normalizeIbiRecord(
  rec: Record<string, unknown>,
  coord: [number, number],
  cfg: { state: string; publisher: string; tag: string; collection?: string }
): DotEvent | null {
  /* layerName is finer-grained than the collection ("ConstructionClosures",
   * "IncidentClosures") — resolve kind from it, falling back to the list
   * endpoint the record came from. A full closure is always kind=closure so
   * it gets avoid severity; partial closure-layers stay construction/other
   * so a single closed lane doesn't false-alarm as a road closure. */
  const layer = str(rec.layerName) || str(rec.type) || cfg.collection || "";
  const kind: DotEvent["kind"] =
    rec.isFullClosure === true
      ? "closure"
      : /incident/i.test(layer)
        ? "incident"
        : /construction/i.test(layer)
          ? "construction"
          : /closure/i.test(layer)
            ? "other"
            : (IBI_KIND[cfg.collection ?? ""] ?? "other");
  const roadName = prettifyRoadName(str(rec.roadwayName)).replace(
    /^(US|SR|SH|FM|CR|IH) (\d+[A-Z]?)$/i,
    "$1-$2"
  );
  const dirRaw = str(rec.direction);
  const direction = IBI_DIRECTION[dirRaw.toLowerCase()] ?? null;
  const desc = stripIbiHtml(str(rec.description));
  const laneDesc = stripIbiHtml(str(rec.laneDescription));
  const { impact, lanesClosed } = ibiLaneImpact(laneDesc, rec.isFullClosure === true);
  const startMs = parseIbiDate(str(rec.startDate));
  const endMs = parseIbiDate(str(rec.endDate));
  const updMs = parseIbiDate(str(rec.lastUpdated));
  const point: [number, number] = coord;
  const id = str(rec.id);

  return {
    id: `ibi-${cfg.tag}:${layer || cfg.collection || "event"}:${id || `${point[0]},${point[1]}`}`,
    state: cfg.state,
    publisher: cfg.publisher,
    kind,
    status: startMs != null && startMs > Date.now() ? "scheduled" : "active",
    title: roadName || (kind === "construction" ? "Road work" : "Road event"),
    roadName,
    direction,
    description:
      desc.slice(0, 500) +
      (laneDesc && !desc.toLowerCase().includes(laneDesc.toLowerCase())
        ? ` · ${laneDesc.slice(0, 120)}`
        : ""),
    restrictionsText: null,
    lanesClosed,
    travelLanesClosed: lanesClosed > 0 ? lanesClosed : null,
    laneSummary: laneDesc || null,
    workType: str(rec.eventSubType) || null,
    vehicleImpact: impact,
    startIso: startMs != null ? new Date(startMs).toISOString() : null,
    endIso: endMs != null ? new Date(endMs).toISOString() : null,
    updatedIso: updMs != null ? new Date(updMs).toISOString() : null,
    point,
    bbox: [point[0], point[1], point[0], point[1]],
    geometry: { type: "Point", coordinates: point },
  };
}

/** One IBI host → all mappable Construction/Incidents/Closures events.
 *  Hosts without a given collection 500 on that endpoint (UT/GA/ID have no
 *  Closures list) — that's a missing collection, not a host outage, so a
 *  collection-level HTTP failure is skipped. Only when EVERY collection
 *  fails do we call the host down. */
async function fetchIbiHostEvents(cfg: {
  host: string;
  state: string;
  publisher: string;
  tag: string;
  skip?: string[];
}): Promise<DotEvent[]> {
  const events: DotEvent[] = [];
  let firstError: unknown = null;
  let okCollections = 0;
  for (const collection of IBI_COLLECTIONS) {
    if (cfg.skip?.includes(collection)) continue;
    let records: Record<string, unknown>[];
    try {
      records = await fetchIbiList(cfg.host, collection);
      okCollections += 1;
    } catch (err) {
      firstError ??= err;
      console.warn(`[dot-feeds] ibi ${cfg.tag}/${collection} skipped:`, err);
      continue;
    }
    if (!records.length) continue;
    /* Geometry is keyed by layerName, which can differ from the collection
     * name (WI's "Closures" list carries layerName "ConstructionClosures"). */
    const layerNames = [...new Set(records.map((r) => str(r.layerName)).filter(Boolean))];
    const iconMaps = new Map<string, Map<string, [number, number]>>();
    for (const layer of layerNames) {
      try {
        iconMaps.set(layer, await fetchIbiIcons(cfg.host, layer));
      } catch {
        /* icon layer missing on this host — records just won't paint */
      }
    }
    for (const rec of records) {
      const layer = str(rec.layerName);
      const coord = iconMaps.get(layer)?.get(String(rec.id));
      if (!coord) continue;
      const ev = normalizeIbiRecord(rec, coord, { ...cfg, collection });
      if (ev) events.push(ev);
    }
  }
  if (okCollections === 0 && firstError) throw firstError;
  return events;
}

/* ── Utah DOT 511 driving conditions ────────────────────────────────────────
 * prod-ut's DrivingConditions list: named route segments × eight 3-hour
 * forecast windows (0–3h … 21–24h) with Condition (Green/Yellow/Red) +
 * ConditionReason (Dry/Wet/Patchy ice/…). Keyless. Only prod-ut deploys
 * this collection — every other IBI host 500s on it (probed 2026-11-15).
 * Green windows are baseline and skipped entirely (no geometry fetch);
 * contiguous non-Green runs become kind:"condition" events carrying the
 * segment's real LINESTRING geometry from /map/data/DrivingConditions/{id}
 * (WKT, EPSG:4326, lng-lat order). This is the forecast counterpart to the
 * plow-report condition feeds — "patchy ice on SR-190 in the next 6h". */
const UT_DC_HOST = "prod-ut.ibi511.com";
const UT_DC_COLLECTION = "DrivingConditions";

interface UtDcWindow {
  startH: number;
  endH: number;
  condition: string;
  reason: string;
}

function utDcWindows(rec: Record<string, unknown>): UtDcWindow[] {
  const out: UtDcWindow[] = [];
  for (const key of Object.keys(rec)) {
    const km = /^timeframe_(\d+)-(\d+)$/.exec(key);
    if (!km) continue;
    try {
      const t = JSON.parse(str(rec[key])) as {
        Condition?: unknown;
        ConditionReason?: unknown;
      };
      out.push({
        startH: Number(km[1]),
        endH: Number(km[2]),
        condition: str(t.Condition),
        reason: str(t.ConditionReason),
      });
    } catch {
      /* malformed timeframe JSON — skip that window */
    }
  }
  return out.sort((a, b) => a.startH - b.startH);
}

/** WKT → GeoJSON. Handles the shapes IBI emits: POINT, LINESTRING,
 *  MULTIPOINT, MULTILINESTRING, POLYGON, MULTIPOLYGON (lng-lat order,
 *  optional Z ordinate ignored). */
function wktToGeoJson(wkt: string): GeoJSON.Geometry | null {
  const m = /^\s*(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON)\s+(.+)$/is.exec(
    wkt.trim()
  );
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const body = m[2].trim();
  const pairs = (s: string): [number, number][] =>
    s
      .split(",")
      .map((p) => {
        const n = p.trim().split(/\s+/).slice(0, 2).map(Number);
        return n.length === 2 && Number.isFinite(n[0]) && Number.isFinite(n[1])
          ? ([n[0], n[1]] as [number, number])
          : null;
      })
      .filter((c): c is [number, number] => c != null);
  const splitTop = (s: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  };
  const strip = (s: string) => s.replace(/^\(+|\)+$/g, "").trim();
  switch (kind) {
    case "POINT": {
      const c = pairs(strip(body))[0];
      return c ? { type: "Point", coordinates: c } : null;
    }
    case "LINESTRING": {
      const c = pairs(strip(body));
      return c.length >= 2 ? { type: "LineString", coordinates: c } : null;
    }
    case "MULTIPOINT": {
      const c = splitTop(strip(body))
        .map((p) => pairs(strip(p))[0])
        .filter((p): p is [number, number] => p != null);
      return c.length ? { type: "MultiPoint", coordinates: c } : null;
    }
    case "MULTILINESTRING": {
      const lines = splitTop(strip(body))
        .map((l) => pairs(strip(l)))
        .filter((l) => l.length >= 2);
      return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
    }
    case "POLYGON": {
      const rings = splitTop(strip(body))
        .map((r) => pairs(strip(r)))
        .filter((r) => r.length >= 4);
      return rings.length ? { type: "Polygon", coordinates: rings } : null;
    }
    case "MULTIPOLYGON": {
      const polys = splitTop(strip(body))
        .map((p) =>
          splitTop(strip(p))
            .map((r) => pairs(strip(r)))
            .filter((r) => r.length >= 4)
        )
        .filter((p) => p.length > 0);
      return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
    }
    default:
      return null;
  }
}

interface UtDcShape {
  geometry: GeoJSON.Geometry | null;
  /** Issuance time (UTC ms) — the anchor the timeframe windows count from. */
  baseMs: number | null;
  updatedIso: string | null;
}

async function fetchUtDcShape(id: string): Promise<UtDcShape | null> {
  const base = `https://${UT_DC_HOST}`;
  const j = (await fetchJson(`${base}/map/data/${UT_DC_COLLECTION}/${id}`, FEED_TIMEOUT_MS)) as {
    lastUpdated?: unknown;
    shape?: unknown;
  };
  const geography = asRecord(asRecord(j.shape).geography);
  const wkt = str(geography.wellKnownText);
  const geometry = wkt ? wktToGeoJson(wkt) : null;
  if (!geometry) return null;
  const updMs = Date.parse(str(j.lastUpdated));
  return {
    geometry,
    baseMs: Number.isFinite(updMs) ? updMs : null,
    updatedIso: Number.isFinite(updMs) ? new Date(updMs).toISOString() : null,
  };
}

function normalizeUtDcRun(
  rec: Record<string, unknown>,
  run: { startH: number; endH: number; reasons: string[] },
  shape: UtDcShape
): DotEvent | null {
  const geo = eventGeo(shape.geometry);
  if (!geo) return null;
  const name = str(rec.name);
  const roadName = (name.match(/^([A-Za-z]{1,4}-?\d+[A-Za-z]?)/)?.[1] ?? "").replace(
    /\s+/g,
    ""
  );
  const reasonLabel = run.reasons.filter(Boolean).join(" / ") || "Poor conditions";
  const windowText =
    run.startH <= 0 ? `next ${run.endH} hours` : `in ${run.startH}–${run.endH} hours`;
  /* Windows count from issuance — absolute bounds when the feed's
   * lastUpdated parsed; nulls when it didn't (app shows no dates then). */
  const startIso =
    shape.baseMs != null ? new Date(shape.baseMs + run.startH * 3_600_000).toISOString() : null;
  const endIso =
    shape.baseMs != null ? new Date(shape.baseMs + run.endH * 3_600_000).toISOString() : null;
  const id = str(rec.id) || str(rec.DT_RowId);

  return {
    id: `utdc:${id}:${run.startH}-${run.endH}`,
    state: "utah",
    publisher: "Utah DOT 511",
    kind: "condition",
    status: "active",
    title: name || "Road condition forecast",
    roadName,
    direction: null,
    description: `${reasonLabel} forecast ${windowText} — Utah DOT 511 driving conditions`,
    restrictionsText: null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: reasonLabel,
    /* vehicleImpact slug drives app severity — keep the feed's own words
     * ("patchy-ice", "snow-covered") so ice/snow slugs hit serious. */
    vehicleImpact: reasonLabel.toLowerCase().replace(/\s+/g, "-").replace(/\//g, "-"),
    startIso,
    endIso,
    updatedIso: shape.updatedIso,
    point: geo.point,
    bbox: geo.bbox,
    geometry: geo.geometry,
  };
}

/** All non-Green DrivingConditions runs on UT's 511 host → condition events. */
async function fetchUtDrivingConditions(): Promise<DotEvent[]> {
  const records = await fetchIbiList(UT_DC_HOST, UT_DC_COLLECTION);
  const events: DotEvent[] = [];
  for (const rec of records) {
    const windows = utDcWindows(rec);
    /* Group contiguous non-Green windows into runs — "0-3 + 3-6 both
     * patchy ice" is one 6-hour hazard, not two. */
    const runs: { startH: number; endH: number; reasons: string[] }[] = [];
    let cur: { startH: number; endH: number; reasons: string[] } | null = null;
    for (const w of windows) {
      const bad = w.condition && w.condition !== "Green";
      if (bad && cur && w.startH <= cur.endH) {
        cur.endH = Math.max(cur.endH, w.endH);
        if (w.reason && !cur.reasons.includes(w.reason)) cur.reasons.push(w.reason);
      } else if (bad) {
        cur = { startH: w.startH, endH: w.endH, reasons: w.reason ? [w.reason] : [] };
        runs.push(cur);
      } else {
        cur = null;
      }
    }
    if (!runs.length) continue;
    /* DrivingConditions records carry DT_RowId, not id (unlike the event
     * collections) — /map/data/ keys on the same value. */
    const id = str(rec.id) || str(rec.DT_RowId);
    if (!id) continue;
    const shape = await fetchUtDcShape(id);
    if (!shape) continue;
    for (const run of runs) {
      const ev = normalizeUtDcRun(rec, run, shape);
      if (ev) events.push(ev);
    }
  }
  return events;
}

/* ── Tennessee Smartway (TDOT ArcGIS, keyless) ──────────────────────────────
 * Not in the WZDx registry at all — this FeatureServer is the only TN feed.
 * WZDx-shaped schema under CD_* names; two layers split by geometry
 * (0 = point events ~35, 1 = line events ~218 live 2026-11-15). Fields:
 * EVENT_TYPE/ EVENT_SUBTYPE, CD_DIRECTION, VEHICLE_IMPACT prose
 * ("Lane Closures", "Westbound All Lanes Blocked"), epoch-ms dates,
 * HAS_CLOSURE, COUNTY_NAME; road name lives inside DESCRIPTION
 * ("Interstate 40 Westbound in Cocke - …"). */
const TN_SMARTWAY_BASE =
  "https://tspatial.tdot.tn.gov/arcgis/rest/services/Smartway/Smartway_Events/FeatureServer";
const TN_SMARTWAY_URL = (layer: number) =>
  `${TN_SMARTWAY_BASE}/${layer}/query?where=1%3D1&outFields=*&f=geojson&outSR=4326&resultRecordCount=2000`;

function tnDateMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  const ms = Date.parse(str(v));
  return Number.isFinite(ms) ? ms : null;
}

/** "Interstate 40 Westbound in Cocke - …" / "State Route 22 both directions…"
 *  → "I-40" / "SR-22". CD_ROAD_NAMES is always null on this feed — the
 *  road reference only exists at the start of DESCRIPTION. */
function tnRoadName(desc: string): string {
  const m = desc.match(
    /^(Interstate|State Route|U\.?S\.?\s*(?:Highway|Route)|SR|US|I)-?\s*(\d+[A-Z]?)/i
  );
  if (!m) return "";
  const kind = m[1]!.toLowerCase();
  const num = m[2]!;
  if (kind.startsWith("interstate") || kind === "i") return `I-${num}`;
  if (kind.startsWith("state") || kind === "sr") return `SR-${num}`;
  return `US-${num}`;
}

function tnDirection(raw: string): string | null {
  if (!raw || /both/i.test(raw)) return null;
  return raw.replace(/\s*bound\s*$/i, "bound");
}

/** VEHICLE_IMPACT prose → the app's slug vocabulary. Direction prefixes
 *  ("Westbound All Lanes Blocked") are stripped before matching. */
function tnImpact(raw: string, hasClosure: boolean): string | null {
  const t = raw.toLowerCase().replace(/^(north|south|east|west)?\s*-?bound\s+/, "");
  if (/all lanes|all traffic|road closed|closed to all/.test(t) && /block|clos|closed/.test(t))
    return "all-lanes-closed";
  if (/^closed\b|\bclosed\b/.test(t) && !/lane|shoulder/.test(t)) return "all-lanes-closed";
  if (/lane|shoulder|closure|blocked/.test(t)) return "some-lanes-closed";
  if (hasClosure) return "all-lanes-closed";
  return null;
}

function tnKind(eventType: string, subtype: string): DotEvent["kind"] {
  const s = `${eventType} ${subtype}`.toLowerCase();
  if (/incident|crash|hazard|diversion|weather|flood/.test(s)) return "incident";
  if (/clos/.test(s)) return "closure";
  /* "Operations" = TDOT work ops — resurfacing, bridge repair, etc. */
  return "construction";
}

function normalizeTnSmartway(
  feature: Record<string, unknown>,
  layerTag: string
): DotEvent | null {
  /* Raw SCREAMING_SNAKE props — snakeKeysDeep mangles ALL-CAPS keys
   * ("CD_EVENT_TYPE" → "_c_d__e_v_e_n_t__t_y_p_e"), so read them direct. */
  const props = asRecord(feature.properties);
  const geo = eventGeo(feature.geometry);
  if (!geo) return null;

  const startMs = tnDateMs(props.START_DATE);
  const endMs = tnDateMs(props.END_DATE);
  const nowMs = Date.now();
  if (endMs != null && endMs < nowMs - WINDOW_PAST_MS) return null;
  if (startMs != null && startMs > nowMs + WINDOW_FUTURE_MS) return null;

  const desc = str(props.DESCRIPTION).slice(0, MAX_DESCRIPTION_CHARS);
  const eventType = str(props.EVENT_TYPE);
  const subtype = str(props.EVENT_SUBTYPE);
  const hc = props.HAS_CLOSURE;
  const hasClosure = hc === 1 || hc === "1" || hc === true;
  const impact = tnImpact(str(props.VEHICLE_IMPACT), hasClosure);
  const roadName = prettifyRoadName(tnRoadName(desc));
  const direction = tnDirection(str(props.CD_DIRECTION));
  const kind = tnKind(eventType, subtype);
  const id = str(feature.id) || str(props.ID) || `${Math.random().toString(36).slice(2, 10)}`;
  const revisedMs = tnDateMs(props.REVISED_DATE);

  return {
    id: `tn${layerTag}:${id}`,
    state: "tennessee",
    publisher: "Tennessee DOT Smartway",
    kind,
    status: startMs != null && startMs > nowMs ? "scheduled" : "active",
    title:
      [roadName, direction].filter(Boolean).join(" · ") ||
      (kind === "construction" ? "Road work" : "Road event"),
    roadName,
    direction,
    description: desc,
    restrictionsText: null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: [eventType, subtype].filter(Boolean).join(" · ") || null,
    vehicleImpact: impact,
    startIso: startMs != null ? new Date(startMs).toISOString() : null,
    endIso: endMs != null ? new Date(endMs).toISOString() : null,
    updatedIso: revisedMs != null ? new Date(revisedMs).toISOString() : null,
    point: geo.point,
    bbox: geo.bbox,
    geometry: geo.geometry,
  };
}

/* ── NE Compass C2C essData (ME/NH/VT RWIS, keyless XML) ─────────────────────
 * nec-por.ne-compass.com serves three-state RWIS sensor stations as C2C XML,
 * zero auth (the audit's /DeveloperPortal/ path 404s — API lives at root).
 * Each <ess> is a road-weather station: roadSurfaceCond (Dry/Wet/Ice/Snow…),
 * pavementTemp/airTemp °F, precip, timestamp, equipLoc>roadway+direction,
 * lat/lon in microdegrees. Dry/Unknown are baseline — skipped like the
 * plow-report feeds so clear roads don't paint as hazards. */
const NE_COMPASS_ESS_URL =
  "https://nec-por.ne-compass.com/NEC.XmlDataPortal/api/c2c" +
  "?networks=Vermont,Maine,NewHampshire&dataTypes=essData";

function xmlTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1]!.replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

const NE_DIRECTION: Record<string, string> = {
  north: "NB", south: "SB", east: "EB", west: "WB",
  nb: "NB", sb: "SB", eb: "EB", wb: "WB",
};

function normalizeNeEss(block: string): DotEvent | null {
  const open = /<ess\b[^>]*>/.exec(block)?.[0] ?? "";
  const essId = /\sid="([^"]+)"/.exec(open)?.[1] ?? "";
  const netId = /netId="([^"]+)"/.exec(open)?.[1] ?? "";
  const state = netId.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (!state || !essId) return null;

  const cond = xmlTag(block, "roadSurfaceCond");
  /* Baseline/no-reading stations stay out — only reported conditions emit. */
  if (!cond || /^(dry|unknown|no data)$/i.test(cond)) return null;

  const lat = Number(xmlTag(block, "lat")) / 1e6;
  const lon = Number(xmlTag(block, "lon")) / 1e6;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const name = xmlTag(block, "name");
  const roadway = prettifyRoadName(xmlTag(block, "roadway"));
  const dirRaw = xmlTag(block, "direction").toLowerCase();
  const direction = NE_DIRECTION[dirRaw] ?? null;
  const paveF = Number(xmlTag(block, "pavementTemp"));
  const airF = Number(xmlTag(block, "airTemp"));
  const tsIso = xmlTag(block, "timestamp") || null;
  const conditionLabel = cond.replace(/\s+/g, " ").trim();
  const point: [number, number] = [lon, lat];

  return {
    id: `necompass:${netId}:${essId}`,
    state,
    publisher: "NE Compass RWIS",
    kind: "condition",
    status: "active",
    title: roadway || "Road weather station",
    roadName: roadway,
    direction,
    description:
      `${conditionLabel} — ${name || "RWIS station"}` +
      (Number.isFinite(paveF) ? ` · pavement ${Math.round(paveF)}°F` : "") +
      (!Number.isFinite(paveF) && Number.isFinite(airF) ? ` · air ${Math.round(airF)}°F` : ""),
    restrictionsText: null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: conditionLabel,
    vehicleImpact: conditionLabel.toLowerCase().replace(/\s+/g, "-"),
    startIso: null,
    endIso: null,
    updatedIso: tsIso && Number.isFinite(Date.parse(tsIso)) ? new Date(tsIso).toISOString() : null,
    point,
    bbox: [lon, lat, lon, lat],
    geometry: { type: "Point", coordinates: point },
  };
}

/** essData XML → condition events for non-baseline road surfaces. */
async function fetchNeCompassConditions(): Promise<DotEvent[]> {
  const res = await fetch(NE_COMPASS_ESS_URL, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS * 2),
    headers: { "User-Agent": "StormPath-DOT-Feeds/1.0 (+https://stormpath.app)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error("ess feed too large");
  const events: DotEvent[] = [];
  for (const m of text.matchAll(/<ess\b[^>]*(?:\/>|>[\s\S]*?<\/ess>)/g)) {
    const ev = normalizeNeEss(m[0]);
    if (ev) events.push(ev);
  }
  return events;
}

/* ── Oregon DOT TripCheck (keyed ODOT_API_KEY, Azure APIM header) ────────────
 * Two feeds behind one subscription:
 *  - Rw/Reports: crew-reported road/weather stretches — Oregon's chain-law
 *    conditions (A carry-chains … D chains required), icy/packed pavement,
 *    snow, fog. Only non-baseline reports emit.
 *  - v2/rwis: automated RWIS stations (inventory + status). Emitted only when
 *    pavement/air is at or below freezing — dry stations stay silent.
 * Temps in Rw/Reports are decimal °C; v2/rwis uses NTCIP tenths of °C. */
const ODOT_RW_REPORTS_URL = "https://api.odot.state.or.us/tripcheck/Rw/Reports";
const ODOT_RWIS_STATUS_URL = "https://api.odot.state.or.us/tripcheck/v2/rwis/status";
const ODOT_RWIS_INVENTORY_URL = "https://api.odot.state.or.us/tripcheck/v2/rwis/inventory";

const ODOT_WEATHER: Record<number, string> = {
  4: "Ground fog", 6: "Rain", 7: "Snow flurries", 8: "Heavy snow",
  91: "Freezing rain", 92: "High winds", 93: "Whiteout",
};
const ODOT_ROAD: Record<number, string> = {
  2: "spots of ice", 3: "black ice", 4: "standing water",
  5: "snow pack breaking up", 6: "packed snow",
};
const ODOT_DRIVING_RESTRICTION: Record<string, string> = {
  A: "Carry chains or traction tires",
  B: "Chains required on vehicles towing or over 10,000 GVW",
  B1: "Chains required on vehicles towing or single drive axle over 10,000 GVW",
  C: "Chains required on vehicles towing or over 10,000 GVW; traction tires allowed under 10,000",
  D: "Chains required. Traction tires alone are not sufficient",
};

function odotRoad(routeId: unknown): string {
  let s = String(routeId ?? "").toUpperCase().replace(/\s+/g, "");
  /* ODOT writes state highways as "HWY372" — that's OR-372 to a driver. */
  s = s.replace(/^HWY-?/, "OR-");
  const m = /^([A-Z]+)-?(\d+[A-Z]*)$/.exec(s);
  return m ? `${m[1]}-${m[2]}` : s;
}

function odotTimeMs(v: unknown): number | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeOdotRwReport(raw: unknown, nowMs: number): DotEvent | null {
  const r = raw as Record<string, unknown>;
  const loc = (r.location ?? {}) as Record<string, unknown>;
  const start = (loc["start-location"] ?? {}) as Record<string, unknown>;
  const end = (loc["end-location"] ?? {}) as Record<string, unknown>;
  const lat = Number(start["start-lat"]);
  const lon = Number(start["start-long"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  const expiryMs = odotTimeMs(r["expiry-time"]);
  if (expiryMs != null && expiryMs < nowMs) return null;

  const restriction = String(
    ((r["driving-restriction"] ?? {}) as Record<string, unknown>)["restriction-id"] ?? ""
  ).toUpperCase();
  const restricted = restriction !== "" && restriction !== "0";
  const roadId = Number(((r["road-conditions"] ?? {}) as Record<string, unknown>)["road-cond-id"]);
  const wxId = Number(((r["weather-conditions"] ?? {}) as Record<string, unknown>)["weather-id"]);
  const chainsRequired = /^[BCD]$/.test(restriction);
  const icy = [2, 3, 5, 6].includes(roadId);
  const snowing = wxId === 7 || wxId === 8 || wxId >= 9;
  const fog = wxId === 4;
  const standingWater = roadId === 4;
  /* Baseline "A" (carry chains or traction tires) is the standing mountain
   * notice — only emit it when pavement/weather says something worse. */
  if (!restricted && !icy && !snowing && !fog && !standingWater) return null;
  if (restriction === "A" && !icy && !snowing && !fog && !standingWater) return null;

  const airC = Number(r["air-temperature"]);
  const road = odotRoad(loc["route-id"]);
  const name = String(loc["location-name"] ?? "")
    .replace(/\b\w+/g, (w) => (/^(NB|SB|EB|WB|US|OR|I|HWY)$/.test(w) ? w : w[0]! + w.slice(1).toLowerCase()))
    .trim();
  const dirRaw = String(loc.direction ?? "").toUpperCase().trim();
  const direction = /^(N|S|E|W|NB|SB|EB|WB)$/.test(dirRaw) ? dirRaw : null;
  const point: [number, number] = [lon, lat];
  const endLat = Number(end["end-lat"]);
  const endLon = Number(end["end-long"]);
  const hasEnd = Number.isFinite(endLat) && Number.isFinite(endLon) && Math.abs(endLat) <= 90 && Math.abs(endLon) <= 180;
  const geom = hasEnd
    ? { type: "LineString", coordinates: [point, [endLon, endLat]] }
    : { type: "Point", coordinates: point };
  const conditionLabel = chainsRequired
    ? `Chains required (condition ${restriction})`
    : restriction === "A"
      ? "Carry chains or traction tires"
      : ODOT_ROAD[roadId] ?? ODOT_WEATHER[wxId] ?? "Road condition";
  const vehicleImpact = chainsRequired
    ? "travel-not-advised"
    : roadId === 3 || roadId === 6 || snowing || wxId >= 9
      ? "packed-snow"
      : icy || fog || standingWater
        ? "partially-covered"
        : "partially-covered";

  return {
    id: `odot-rw:${r["station-id"] ?? `${lon},${lat}`}`,
    state: "oregon",
    publisher: "Oregon DOT TripCheck",
    kind: "condition",
    status: "active",
    title: [road || name, name && road ? name : ""].filter(Boolean).join(" · ") || "Oregon road report",
    roadName: road,
    direction,
    description:
      `${conditionLabel}${Number.isFinite(airC) ? ` · air ${Math.round(airC * 9 / 5 + 32)}°F` : ""}` +
      (Number.isFinite(Number(r["adjacent-snow-depth"])) && Number(r["adjacent-snow-depth"]) > 0
        ? ` · snow depth ${r["adjacent-snow-depth"]}`
        : ""),
    restrictionsText: ODOT_DRIVING_RESTRICTION[restriction] ?? null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: conditionLabel,
    vehicleImpact,
    startIso: null,
    endIso: expiryMs ? new Date(expiryMs).toISOString() : null,
    updatedIso: typeof r["entry-time"] === "string" ? new Date(String(r["entry-time"])).toISOString() : null,
    point,
    bbox: hasEnd ? [Math.min(lon, endLon), Math.min(lat, endLat), Math.max(lon, endLon), Math.max(lat, endLat)] : [lon, lat, lon, lat],
    geometry: geom,
  };
}

async function fetchOdotRwReports(env: FeedEnv, nowMs: number): Promise<DotEvent[]> {
  const key = env.ODOT_API_KEY;
  if (!key) return [];
  const res = await fetchJson(ODOT_RW_REPORTS_URL, FEED_TIMEOUT_MS, {
    "Ocp-Apim-Subscription-Key": key,
  });
  const rows = (res as Record<string, unknown>)["road-weather-reports"];
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(0, 500)
    .map((r) => normalizeOdotRwReport(r, nowMs))
    .filter((e): e is DotEvent => e != null);
}

async function fetchOdotRwis(env: FeedEnv, nowMs: number): Promise<DotEvent[]> {
  const key = env.ODOT_API_KEY;
  if (!key) return [];
  const headers = { "Ocp-Apim-Subscription-Key": key };
  const [statusRes, invRes] = await Promise.all([
    fetchJson(ODOT_RWIS_STATUS_URL, FEED_TIMEOUT_MS, headers),
    fetchJson(ODOT_RWIS_INVENTORY_URL, FEED_TIMEOUT_MS, headers).catch(() => null),
  ]);
  /* station-id → name/route/coords for readable titles. */
  const meta = new Map<string, { name: string; road: string; lat: number; lon: number }>();
  const invRows = (invRes as Record<string, unknown> | null)?.["ess-site-list"];
  if (Array.isArray(invRows)) {
    for (const s of invRows.slice(0, 500)) {
      const st = s as Record<string, unknown>;
      const id = String(st["station-id"] ?? "");
      const lat = Number(st.latitude);
      const lon = Number(st.longitude);
      if (id && Number.isFinite(lat) && Number.isFinite(lon)) {
        meta.set(id, {
          name: String(st["station-name"] ?? ""),
          road: odotRoad(st["route-id"]),
          lat,
          lon,
        });
      }
    }
  }
  const stations = (statusRes as Record<string, unknown>).WeatherStations;
  if (!Array.isArray(stations)) return [];
  const out: DotEvent[] = [];
  for (const s of stations.slice(0, 500)) {
    const st = s as Record<string, unknown>;
    const id = String(st["station-id"] ?? "");
    const rw = (st.RoadWeather ?? {}) as Record<string, unknown>;
    const sc = (st.SurfaceCondition ?? {}) as Record<string, unknown>;
    const temps = sc["surface-temperatures"];
    const surfC = Array.isArray(temps) && temps.length
      ? Number((temps[0] as Record<string, unknown>)["surface-temperature"]) / 10
      : NaN;
    const airC = Number(rw["air-temperature"]) / 10;
    const freezing = (Number.isFinite(surfC) && surfC <= 0.5) || (!Number.isFinite(surfC) && Number.isFinite(airC) && airC <= 0);
    if (!freezing) continue;
    const info = meta.get(id);
    const point: [number, number] = info ? [info.lon, info.lat] : [NaN, NaN];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const road = info?.road ?? "";
    const name = (info?.name ?? "").replace(/\s+/g, " ").trim();
    const label = Number.isFinite(surfC) ? `pavement ${Math.round(surfC * 9 / 5 + 32)}°F` : `air ${Math.round(airC * 9 / 5 + 32)}°F`;
    out.push({
      id: `odot-rwis:${id}`,
      state: "oregon",
      publisher: "Oregon DOT TripCheck RWIS",
      kind: "condition",
      status: "active",
      title: [road, name].filter(Boolean).join(" · ") || "Oregon road weather station",
      roadName: road,
      direction: null,
      description: `At or below freezing — ${label}.`,
      restrictionsText: null,
      lanesClosed: 0,
      travelLanesClosed: null,
      laneSummary: null,
      workType: "Freezing road surface",
      vehicleImpact: "ice",
      startIso: null,
      endIso: null,
      updatedIso: typeof rw["last-update-time"] === "string" ? new Date(String(rw["last-update-time"])).toISOString() : null,
      point,
      bbox: [point[0], point[1], point[0], point[1]],
      geometry: { type: "Point", coordinates: point },
    });
  }
  return out;
}

/* ── Caltrans CWWP2 (keyless) ───────────────────────────────────────────────
 * 12 district LCS files (lane closures, ~5 min cadence) + 9 CC files
 * (chain controls, ~1 min) + 8 RWIS files (road weather stations).
 * LCS is filtered to mainline/conventional closures active now or starting
 * within 24 h — the files carry 7 days of planned work (~9.5k rows total)
 * that would flood the snapshot; near-term is what a driver needs. */
const CALTRANS_DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const CALTRANS_CC_DISTRICTS = [1, 2, 3, 6, 7, 8, 9, 10, 11];
const CALTRANS_RWIS_DISTRICTS = [1, 2, 3, 6, 8, 9, 10];
const caltransUrl = (feed: string, d: number) =>
  `https://cwwp2.dot.ca.gov/data/d${d}/${feed}/${feed}StatusD${String(d).padStart(2, "0")}.json`;

const CALTRANS_THROUGH_FACILITY = /^(mainline|conventional hwy)$/i;
const CALTRANS_CC_STATUS = /^(R-?[0-3]( MODIFIED)?|ESC|TH|TS|TTA|TTS|TTSD|VM|HT|MIN|MAX|W|RC|ROAD CLOSED)$/i;

function caltransRecords(json: unknown, feed: string): Record<string, unknown>[] {
  const data = (json as Record<string, unknown>)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((d) => {
      const row = (d as Record<string, unknown>)?.[feed];
      return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
    })
    .filter((r): r is Record<string, unknown> => r != null);
}

function caltransEpochMs(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 1e9 ? n * 1000 : null;
}

function caltransValid(lat: number, lon: number): boolean {
  return lat > 32 && lat < 42.5 && lon > -125 && lon < -114;
}

function normalizeCaltransLcs(raw: Record<string, unknown>, nowMs: number): DotEvent | null {
  const loc = (raw.location ?? {}) as Record<string, unknown>;
  const begin = (loc.begin ?? {}) as Record<string, unknown>;
  const end = (loc.end ?? {}) as Record<string, unknown>;
  const c = (raw.closure ?? {}) as Record<string, unknown>;
  if (!CALTRANS_THROUGH_FACILITY.test(String(c.facility ?? ""))) return null;
  if (String((c.code1022 as Record<string, unknown>)?.isCode1022 ?? "") === "true") return null;
  if (String((c.code1098 as Record<string, unknown>)?.isCode1098 ?? "") === "true") return null;

  const ts = (c.closureTimestamp ?? {}) as Record<string, unknown>;
  const startMs = caltransEpochMs(ts.closureStartEpoch);
  const endMs = String(ts.isClosureEndIndefinite ?? "") === "true" ? null : caltransEpochMs(ts.closureEndEpoch);
  if (endMs != null && endMs < nowMs) return null;
  /* Keep: live now, or starting within 24 h. Planned work beyond that waits
   * for a later snapshot — keeps ~590 events instead of ~9.5k rows. */
  if (startMs == null && endMs == null) return null;
  if (startMs != null && startMs > nowMs + 24 * 3_600_000) return null;
  const onNow = (startMs == null || startMs <= nowMs) && (endMs == null || endMs >= nowMs);
  const upcoming = !onNow && startMs != null && startMs <= nowMs + 24 * 3_600_000;
  if (!onNow && !upcoming) return null;

  const lat = Number(begin.beginLatitude);
  const lon = Number(begin.beginLongitude);
  if (!caltransValid(lat, lon)) return null;
  const endLat = Number(end.endLatitude);
  const endLon = Number(end.endLongitude);
  const hasEnd = caltransValid(endLat, endLon);
  const road = prettifyRoadName(String(begin.beginRoute ?? ""));
  const dirRaw = String(loc.travelFlowDirection ?? "");
  const direction = /north/i.test(dirRaw) ? "NB" : /south/i.test(dirRaw) ? "SB" : /east/i.test(dirRaw) ? "EB" : /west/i.test(dirRaw) ? "WB" : null;
  const type = String(c.typeOfClosure ?? "");
  const full = /^full$/i.test(type);
  const lanesRaw = String(c.lanesClosed ?? "");
  const tokens = lanesRaw.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => /shoulder/i.test(t))) return null;
  const total = Number(c.totalExistingLanes);
  const closedCount = /^all$/i.test(lanesRaw) ? (Number.isFinite(total) ? total : 1) : tokens.filter((t) => /^\d+$/.test(t)).length;
  const work = String(c.typeOfWork ?? "").trim();
  const from = String(begin.beginLocationName ?? "");
  const near = String(begin.beginNearbyPlace ?? "");
  const point: [number, number] = [lon, lat];
  const geom = hasEnd
    ? { type: "LineString", coordinates: [point, [endLon, endLat]] }
    : { type: "Point", coordinates: point };
  const delay = Number(c.estimatedDelay);
  const vehicleImpact = full ? "all-lanes-closed" : closedCount > 0 ? "some-lanes-closed" : null;
  const laneSummary =
    /^all$/i.test(lanesRaw) ? "all lanes" : closedCount > 0 ? `${closedCount} lane${closedCount > 1 ? "s" : ""} closed` : lanesRaw || null;

  return {
    id: `caltrans-lcs:${String(raw.index ?? `${lon},${lat}`)}`,
    state: "california",
    publisher: "Caltrans",
    kind: full ? "closure" : "construction",
    status: onNow ? "active" : "scheduled",
    title: [road, direction, full ? "Road closed" : "Lane closure"].filter(Boolean).join(" · ") ||
      [road, "Lane closure"].filter(Boolean).join(" · "),
    roadName: road,
    direction,
    description:
      `${laneSummary ? laneSummary[0]!.toUpperCase() + laneSummary.slice(1) : "Lane closure"}` +
      `${work ? ` for ${work.toLowerCase()}` : ""}` +
      `${from ? ` at ${from}` : near ? ` near ${near}` : ""}` +
      `${Number.isFinite(delay) && delay > 0 ? ` · est. delay ${Math.round(delay)} min` : ""}`,
    restrictionsText: null,
    lanesClosed: closedCount,
    travelLanesClosed: closedCount,
    laneSummary,
    workType: work || (full ? "Road closure" : "Lane closure"),
    vehicleImpact,
    startIso: startMs ? new Date(startMs).toISOString() : null,
    endIso: endMs ? new Date(endMs).toISOString() : null,
    updatedIso: caltransEpochMs((raw.recordTimestamp as Record<string, unknown>)?.recordEpoch)
      ? new Date(caltransEpochMs((raw.recordTimestamp as Record<string, unknown>)?.recordEpoch)!).toISOString()
      : null,
    point,
    bbox: hasEnd ? [Math.min(lon, endLon), Math.min(lat, endLat), Math.max(lon, endLon), Math.max(lat, endLat)] : [lon, lat, lon, lat],
    geometry: geom,
  };
}

function normalizeCaltransCc(raw: Record<string, unknown>): DotEvent | null {
  const loc = (raw.location ?? {}) as Record<string, unknown>;
  const sd = (raw.statusData ?? {}) as Record<string, unknown>;
  const status = String(sd.status ?? "").toUpperCase();
  if (!CALTRANS_CC_STATUS.test(status)) return null;
  if (/^R-?0$/i.test(status)) return null;
  if (String(raw.inService ?? "") === "false") return null;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!caltransValid(lat, lon)) return null;
  const road = prettifyRoadName(String(loc.route ?? ""));
  const point: [number, number] = [lon, lat];
  const closed = status === "RC" || status === "ROAD CLOSED";
  const chains = /^(R-?[123]|ESC|TH|TS|TTA|TTS|TTSD)$/.test(status);
  const warning = status === "W";
  const name = String(loc.locationName ?? loc.nearbyPlace ?? "road weather station");
  const ts = (sd.statusTimestamp ?? {}) as Record<string, unknown>;
  const updatedIso = ts.statusDate && ts.statusTime
    ? new Date(`${ts.statusDate}T${ts.statusTime}-08:00`).toISOString()
    : null;
  return {
    id: `caltrans-cc:${String(raw.index ?? `${lon},${lat}`)}`,
    state: "california",
    publisher: "Caltrans",
    kind: closed ? "closure" : "condition",
    status: "active",
    title: [road, closed ? "Road closed" : chains ? `Chain controls ${status}` : warning ? "Chain advisory" : `Chain control ${status}`].filter(Boolean).join(" · ") || name,
    roadName: road,
    direction: null,
    description: `${String(sd.statusDescription ?? "")}${road ? ` · ${road}` : ""}`.trim() || `Chain control point: ${name}`,
    restrictionsText: String(sd.statusDescription ?? "") || null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: closed ? "Road closure" : "Chain control",
    vehicleImpact: closed ? "all-lanes-closed" : chains ? "ice" : "partially-covered",
    startIso: null,
    endIso: null,
    updatedIso,
    point,
    bbox: [lon, lat, lon, lat],
    geometry: { type: "Point", coordinates: point },
  };
}

function normalizeCaltransRwis(raw: Record<string, unknown>, nowMs: number): DotEvent | null {
  const r = raw as Record<string, unknown>;
  const loc = (r.location ?? {}) as Record<string, unknown>;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!caltransValid(lat, lon)) return null;
  if (String(r.inService ?? "") === "false") return null;
  const rts = (r.recordTimestamp ?? {}) as Record<string, unknown>;
  const updatedMs = caltransEpochMs(rts.recordEpoch);
  if (updatedMs != null && nowMs - updatedMs > 3 * 3_600_000) return null;
  const data = (r.rwisData ?? {}) as Record<string, unknown>;
  const tenth = (v: unknown, max: number): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > -1000 && n < max ? n / 10 : null;
  };
  const temps = (data.temperatureData as Record<string, unknown>)?.essTemperatureSensorTable;
  const first = Array.isArray(temps) ? (temps[0] as Record<string, unknown>) : null;
  const airC = first ? tenth((first.essTemperatureSensorEntry as Record<string, unknown>)?.essAirTemperature, 1001) : null;
  const pav = (data.pavementSensorData as Record<string, unknown>)?.essPavementSensorTable;
  const pfirst = Array.isArray(pav) ? (pav[0] as Record<string, unknown>) : null;
  const surfC = pfirst ? tenth((pfirst.essPavementSensorEntry as Record<string, unknown>)?.essSurfaceTemperature, 1001) : null;
  const freezing = (surfC != null && surfC <= 0.5) || (surfC == null && airC != null && airC <= 0);
  if (!freezing) return null;
  const road = prettifyRoadName(String(loc.route ?? ""));
  const name = String(loc.locationName ?? loc.nearbyPlace ?? "road weather station").replace(/\s*:\s*/g, " ");
  const point: [number, number] = [lon, lat];
  const label = surfC != null ? `pavement ${Math.round(surfC * 9 / 5 + 32)}°F` : `air ${Math.round((airC ?? 0) * 9 / 5 + 32)}°F`;
  return {
    id: `caltrans-rwis:${String(loc.district ?? "")}-${String(r.index ?? `${lon},${lat}`)}`,
    state: "california",
    publisher: "Caltrans",
    kind: "condition",
    status: "active",
    title: [road, name].filter(Boolean).join(" · ") || "California road weather station",
    roadName: road,
    direction: null,
    description: `At or below freezing — ${label}.`,
    restrictionsText: null,
    lanesClosed: 0,
    travelLanesClosed: null,
    laneSummary: null,
    workType: "Freezing road surface",
    vehicleImpact: "ice",
    startIso: null,
    endIso: null,
    updatedIso: updatedMs ? new Date(updatedMs).toISOString() : null,
    point,
    bbox: [lon, lat, lon, lat],
    geometry: { type: "Point", coordinates: point },
  };
}

async function fetchCaltransFeeds(
  nowMs: number,
  record: (name: string, state: "ok" | "failed", count: number, error?: string) => void
): Promise<DotEvent[]> {
  const events: DotEvent[] = [];
  /* Districts fetch in small batches — the Node snapshot runner has no CPU
   * cap but 12×~1 MB JSON files shouldn't all sit in memory at once. */
  const jobs: { name: string; url: string; feed: string; normalize: (r: Record<string, unknown>) => DotEvent | null }[] = [];
  for (const d of CALTRANS_DISTRICTS)
    jobs.push({ name: `caltrans-lcs-d${d}`, url: caltransUrl("lcs", d), feed: "lcs", normalize: (r) => normalizeCaltransLcs(r, nowMs) });
  for (const d of CALTRANS_CC_DISTRICTS)
    jobs.push({ name: `caltrans-cc-d${d}`, url: caltransUrl("cc", d), feed: "cc", normalize: normalizeCaltransCc });
  for (const d of CALTRANS_RWIS_DISTRICTS)
    jobs.push({ name: `caltrans-rwis-d${d}`, url: caltransUrl("rwis", d), feed: "rwis", normalize: (r) => normalizeCaltransRwis(r, nowMs) });
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(
      jobs.slice(i, i + 4).map(async (job) => {
        const before = events.length;
        try {
          const json = await fetchJson(job.url, FEED_TIMEOUT_MS * 2);
          for (const rec of caltransRecords(json, job.feed)) {
            const ev = job.normalize(rec);
            if (ev) events.push(ev);
          }
          record(job.name, "ok", events.length - before);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.warn(`[dot-feeds] caltrans feed failed: ${job.name}`, err);
          record(job.name, "failed", 0, error);
        }
      })
    );
  }
  return events;
}

const CUSTOM_FEEDS: CustomFeed[] = [
  {
    name: "ilwinter",
    state: "illinois",
    publisher: "Illinois DOT",
    url: IL_WINTER_URL,
    normalize: normalizeIllinoisWinter,
  },
  {
    name: "iawinter",
    state: "iowa",
    publisher: "Iowa DOT",
    url: IA_WINTER_URL,
    normalize: normalizeIowaWinter,
  },
  {
    name: "mowinter",
    state: "missouri",
    publisher: "Missouri DOT",
    url: MO_WINTER_URL,
    normalize: normalizeMissouriWinter,
  },
  {
    name: "mdchart-events",
    state: "maryland",
    publisher: "Maryland DOT CHART",
    url: MD_CHART_INCIDENTS_URL,
    normalize: normalizeMdChartWinter,
    pick: pickChartData,
  },
  {
    name: "mdchart-closures",
    state: "maryland",
    publisher: "Maryland DOT CHART",
    url: MD_CHART_CLOSURES_URL,
    normalize: normalizeMdChartWinter,
    pick: pickChartData,
  },
  /* Tennessee — TDOT Smartway ArcGIS FeatureServer, keyless, WZDx-shaped
   * but not in the registry. Layer 0 = point events, layer 1 = line
   * events; OBJECTIDs are per-layer so the tag keeps ids unique. */
  {
    name: "tn-smartway-points",
    state: "tennessee",
    publisher: "Tennessee DOT Smartway",
    url: TN_SMARTWAY_URL(0),
    normalize: (f) => normalizeTnSmartway(f, "p"),
  },
  {
    name: "tn-smartway-lines",
    state: "tennessee",
    publisher: "Tennessee DOT Smartway",
    url: TN_SMARTWAY_URL(1),
    normalize: (f) => normalizeTnSmartway(f, "l"),
  },
];

export async function buildSnapshot(env: FeedEnv): Promise<Snapshot> {
  const nowMs = Date.now();
  const registry = (await fetchJson(REGISTRY_URL, 15_000)) as RegistryRow[];
  const rows = registry.filter((r) => feedUrlOf(r));

  const events: DotEvent[] = [];
  const coveredStates = new Set<string>();
  const feedStatus: FeedStatus[] = [];
  let failed = 0;
  let skippedKeyed = 0;
  /* Sequential batches — holding ~30 parsed GeoJSON feeds at once exceeds
   * the 128 MB isolate limit. Batches of 4 keep peak memory ~40 MB. */
  for (let i = 0; i < rows.length; i += FEED_BATCH) {
    const batch = rows.slice(i, i + FEED_BATCH);
    await Promise.all(
      batch.map(async (row) => {
        const feedName = row.feedname ?? "registry";
        const auth = authFor(row, env);
        if (!auth) {
          if (isKeyed(row)) skippedKeyed += 1;
          feedStatus.push({
            name: feedName,
            source: "registry",
            state: "skipped",
            events: 0,
            error: "keyed feed, no secret configured",
          });
          return;
        }
        const before = events.length;
        try {
          const rawFeed = (await fetchJson(auth.url, FEED_TIMEOUT_MS, auth.headers)) as unknown;
          /* MDOT RIDE wraps its feed in a single-element array
           * ([{features:[...], road_event_feed_info}]) — unwrap to the
           * object that actually carries `features`. */
          const feed = (
            Array.isArray(rawFeed)
              ? (rawFeed.find(
                  (el) =>
                    el != null &&
                    typeof el === "object" &&
                    ("features" in el || "road_events" in el)
                ) ?? rawFeed[0])
              : rawFeed
          ) as Record<string, unknown>;
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
          feedStatus.push({
            name: feedName,
            source: "registry",
            state: "ok",
            events: events.length - before,
          });
        } catch (err) {
          failed += 1;
          const error = err instanceof Error ? err.message : String(err);
          console.warn(`[dot-feeds] feed failed: ${feedName}`, err);
          feedStatus.push({ name: feedName, source: "registry", state: "failed", events: 0, error });
        }
      })
    );
  }
  if (skippedKeyed > 0)
    console.warn(`[dot-feeds] ${skippedKeyed} keyed feeds skipped (no secret configured)`);

  /* Non-registry feeds (state condition layers etc.) — fetched after the
   * registry batches so a failure here can't take down WZDx coverage. */
  for (const feed of CUSTOM_FEEDS) {
    const before = events.length;
    try {
      const data = (await fetchJson(feed.url, FEED_TIMEOUT_MS)) as Record<string, unknown>;
      for (const s of stateNamesOf(feed.state)) coveredStates.add(s);
      const raw = feed.pick ? feed.pick(data) : asArray<Record<string, unknown>>(data.features);
      const features = raw.slice(0, MAX_FEATURES_PER_FEED);
      for (const f of features) {
        const ev = feed.normalize(f);
        if (ev) events.push(ev);
      }
      feedStatus.push({
        name: feed.name,
        source: "custom",
        state: "ok",
        events: events.length - before,
      });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[dot-feeds] custom feed failed: ${feed.name}`, err);
      feedStatus.push({ name: feed.name, source: "custom", state: "failed", events: 0, error });
    }
  }

  /* IBI/CARS 511 hosts — one adapter covers every prod-*.ibi511.com
   * deployment (list feed + bulk mapIcons, no key). A host failure is
   * isolated per state like the custom feeds above. */
  for (const host of IBI_HOSTS) {
    const before = events.length;
    try {
      const hostEvents = await fetchIbiHostEvents(host);
      for (const s of stateNamesOf(host.state)) coveredStates.add(s);
      events.push(...hostEvents);
      feedStatus.push({
        name: `ibi-${host.tag}`,
        source: "custom",
        state: "ok",
        events: events.length - before,
      });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[dot-feeds] IBI host failed: ${host.host}`, err);
      feedStatus.push({
        name: `ibi-${host.tag}`,
        source: "custom",
        state: "failed",
        events: 0,
        error,
      });
    }
  }

  /* Utah driving-conditions forecast — separate feed status from ibi-ut
   * so a conditions outage doesn't mask (or get masked by) the events feed. */
  {
    const before = events.length;
    try {
      const dcEvents = await fetchUtDrivingConditions();
      for (const s of stateNamesOf("utah")) coveredStates.add(s);
      events.push(...dcEvents);
      feedStatus.push({
        name: "utconditions",
        source: "custom",
        state: "ok",
        events: events.length - before,
      });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[dot-feeds] utah driving conditions failed`, err);
      feedStatus.push({
        name: "utconditions",
        source: "custom",
        state: "failed",
        events: 0,
        error,
      });
    }
  }

  /* NE Compass RWIS — one XML feed covers ME/NH/VT road-surface sensors.
   * A successful fetch means all three networks reported (even when every
   * station reads Dry — that's honest "clear", not missing data). */
  {
    const before = events.length;
    try {
      const neEvents = await fetchNeCompassConditions();
      for (const s of ["maine", "new hampshire", "vermont"]) coveredStates.add(s);
      events.push(...neEvents);
      feedStatus.push({
        name: "necompass-rwis",
        source: "custom",
        state: "ok",
        events: events.length - before,
      });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[dot-feeds] NE Compass RWIS failed`, err);
      feedStatus.push({
        name: "necompass-rwis",
        source: "custom",
        state: "failed",
        events: 0,
        error,
      });
    }
  }

  /* Oregon DOT TripCheck — crew road/weather reports + RWIS stations, both
   * behind ODOT_API_KEY. Reports and sensors get separate statuses so a
   * sensor outage doesn't mask crew reports (and vice versa). */
  {
    const before = events.length;
    try {
      const odReports = await fetchOdotRwReports(env, nowMs);
      for (const s of stateNamesOf("oregon")) coveredStates.add(s);
      events.push(...odReports);
      feedStatus.push({
        name: "odot-rw-reports",
        source: "custom",
        state: "ok",
        events: events.length - before,
      });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[dot-feeds] ODOT road-weather reports failed`, err);
      feedStatus.push({ name: "odot-rw-reports", source: "custom", state: "failed", events: 0, error });
    }
  }
  {
    const before = events.length;
    try {
      const odRwis = await fetchOdotRwis(env, nowMs);
      for (const s of stateNamesOf("oregon")) coveredStates.add(s);
      events.push(...odRwis);
      feedStatus.push({
        name: "odot-rwis",
        source: "custom",
        state: "ok",
        events: events.length - before,
      });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[dot-feeds] ODOT RWIS failed`, err);
      feedStatus.push({ name: "odot-rwis", source: "custom", state: "failed", events: 0, error });
    }
  }

  /* Caltrans CWWP2 — statewide construction/lane closures (LCS), chain
   * controls (CC), and freezing RWIS stations. Keyless; each district feed
   * reports its own status so one bad district can't take down the rest. */
  {
    const before = events.length;
    try {
      const caEvents = await fetchCaltransFeeds(nowMs, (name, state, count, error) => {
        if (state === "failed") failed += 1;
        feedStatus.push({ name, source: "custom", state, events: count, error });
      });
      for (const s of stateNamesOf("california")) coveredStates.add(s);
      events.push(...caEvents);
      feedStatus.push({
        name: "caltrans-summary",
        source: "custom",
        state: "ok",
        events: events.length - before,
      });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[dot-feeds] Caltrans feeds failed`, err);
      feedStatus.push({ name: "caltrans-summary", source: "custom", state: "failed", events: 0, error });
    }
  }

  if (failed > 0) console.warn(`[dot-feeds] ${failed} feeds failed`);

  events.sort((a, b) => a.id.localeCompare(b.id));
  return {
    fetchedAt: nowMs,
    events,
    states: [...coveredStates].sort(),
    feeds: feedStatus,
  };
}

async function snapshot(cachesApi: Cache, env: FeedEnv): Promise<Snapshot | null> {
  /* L1: per-PoP edge cache (cheap, keeps KV reads down). */
  const hit = await cachesApi.match(SNAPSHOT_CACHE_URL);
  if (hit) {
    try {
      return (await hit.json()) as Snapshot;
    } catch {
      /* fall through to KV */
    }
  }
  /* L2: KV is globally replicated — the Action's /ingest lands here once and
   * every PoP sees it. Repopulate L1 so follow-up reads stay off KV. */
  const stored = await env.SNAPSHOTS?.get(SNAPSHOT_KV_KEY, "json").catch(() => null);
  if (!stored || typeof stored !== "object") return null;
  const snap = stored as Snapshot;
  await cachesApi
    .put(
      SNAPSHOT_CACHE_URL,
      new Response(JSON.stringify(snap), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=240" },
      })
    )
    .catch(() => {});
  return snap;
}

/** /ingest payload check — the Action sends exactly what buildSnapshot made. */
function isSnapshot(v: unknown): v is Snapshot {
  const s = v as Snapshot | null;
  return (
    !!s &&
    typeof s.fetchedAt === "number" &&
    Date.now() - s.fetchedAt < 60 * 60_000 &&
    Array.isArray(s.events)
  );
}

function bboxIntersects(a: number[], b: number[]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const bindings = (env ?? {}) as FeedEnv;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    /* The GitHub Action posts a freshly built snapshot here. Bearer secret
     * keeps it write-only for us; reads stay GET. */
    if (url.pathname === "/ingest") {
      if (request.method !== "POST")
        return new Response("Method not allowed", { status: 405, headers: CORS });
      const auth = request.headers.get("Authorization") ?? "";
      if (!bindings.INGEST_SECRET || auth !== `Bearer ${bindings.INGEST_SECRET}`)
        return new Response("unauthorized", { status: 401, headers: CORS });
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response("bad json", { status: 400, headers: CORS });
      }
      if (!isSnapshot(body))
        return new Response("bad snapshot", { status: 400, headers: CORS });
      /* Carry per-feed failure streaks forward from the previous snapshot:
       * a feed that failed last push AND this push is "sustained down";
       * a one-off timeout stays streak 1 and doesn't page anyone. */
      if (Array.isArray(body.feeds)) {
        const prev = (await bindings.SNAPSHOTS?.get(SNAPSHOT_KV_KEY, "json").catch(
          () => null
        )) as Snapshot | null;
        if (prev?.feeds?.length) {
          const prevByName = new Map(prev.feeds.map((f) => [f.name, f]));
          for (const f of body.feeds) {
            if (f.state !== "failed") continue;
            const p = prevByName.get(f.name);
            f.failStreak = (p?.state === "failed" ? (p.failStreak ?? 1) : 0) + 1;
          }
        }
      }
      /* KV is the global store every PoP reads; the local cache entry just
       * warms this colo so the next read skips the KV hop. */
      await bindings.SNAPSHOTS?.put(SNAPSHOT_KV_KEY, JSON.stringify(body));
      await caches.default.put(
        SNAPSHOT_CACHE_URL,
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=240" },
        })
      );
      return Response.json(
        { ok: true, events: body.events.length, fetchedAt: body.fetchedAt },
        { headers: CORS }
      );
    }

    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405, headers: CORS });

    if (url.pathname === "/" || url.pathname === "/health") {
      const snap = await snapshot(caches.default, bindings);
      const feeds = snap?.feeds ?? [];
      return Response.json(
        {
          ok: true,
          events: snap?.events.length ?? 0,
          ageSec: snap ? Math.round((Date.now() - snap.fetchedAt) / 1000) : null,
          states: snap?.states?.length ?? null,
          feedsTotal: feeds.length || null,
          feedsOk: feeds.filter((f) => f.state === "ok").length || null,
          feedsSkipped: feeds.filter((f) => f.state === "skipped").length || null,
          /* Name + error only — enough for the ops page and the Action's
           * health gate without shipping the whole feed list. */
          feedsFailed: feeds
            .filter((f) => f.state === "failed")
            .map((f) => ({
              name: f.name,
              error: f.error ?? "failed",
              streak: f.failStreak ?? 1,
            })),
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

    return new Response("not found", { status: 404, headers: CORS });
  },
};
