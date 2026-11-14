// cloudflare/dot-feeds/src/index.ts
var REGISTRY_URL = "https://data.transportation.gov/resource/69qe-yiui.json?$where=active=true&$limit=300";
var SNAPSHOT_CACHE_URL = "https://stormpath-dot-feeds.internal/snapshot";
var WINDOW_PAST_MS = 12 * 36e5;
var WINDOW_FUTURE_MS = 7 * 24 * 36e5;
var FEED_TIMEOUT_MS = 12e3;
var FEED_BATCH = 4;
var MAX_FEED_BYTES = 15 * 1024 * 1024;
var SIMPLIFIED_GEOM_POINTS = 50;
var MAX_FEATURES_PER_FEED = 4e3;
var MAX_DESCRIPTION_CHARS = 400;
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var KEYED_FEEDS = {
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
  mdot_4: { secret: "MDOT_API_KEY", header: "X-App-Token" },
  /* Socrata app token */
  massdot__cwz: { secret: "MASSDOT_CWZ_API_KEY", header: "Authorization", prefix: "Bearer " },
  ncdot: { secret: "NCDOT_API_KEY", header: "Authorization", prefix: "Bearer " },
  ordot: { secret: "ODOT_API_KEY", header: "Ocp-Apim-Subscription-Key" }
  /* Azure APIM */
};
function feedUrlOf(row) {
  const u = row.url;
  if (typeof u === "string") return u || null;
  return u?.url?.trim() || null;
}
function asRecord(v) {
  return v && typeof v === "object" ? v : {};
}
function snakeKey(k) {
  return k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
function snakeKeysDeep(v, depth = 0) {
  if (depth > 6 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => snakeKeysDeep(x, depth + 1));
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    out[snakeKey(k)] = snakeKeysDeep(val, depth + 1);
  }
  return out;
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function coreOf(props) {
  return { ...props, ...asRecord(props.core_details) };
}
function eventKind(eventType) {
  const t = eventType.toLowerCase();
  if (t.includes("work") || t.includes("construction") || t.includes("maintenance"))
    return "construction";
  if (t.includes("clos")) return "closure";
  if (t.includes("incident") || t.includes("crash") || t.includes("hazard"))
    return "incident";
  return "other";
}
function prettifyRoadName(name) {
  const interstate = name.match(/^I-?(\d+)$/i);
  if (interstate) return `I-${parseInt(interstate[1], 10)}`;
  const tx = name.match(/^(IH|US|SH|SL|SS|FM|RM|BI|BU)(\d+)([A-Z])?$/i);
  if (tx) {
    const kind = tx[1].toUpperCase();
    const num = parseInt(tx[2], 10);
    const suffix = tx[3] ? ` ${tx[3]}` : "";
    switch (kind) {
      case "IH":
        return `I-${num}${suffix}`;
      case "US":
        return `US-${num}${suffix}`;
      case "SH":
        return `SH ${num}${suffix}`;
      case "SL":
        return `Loop ${num}${suffix}`;
      case "SS":
        return `Spur ${num}${suffix}`;
      case "FM":
        return `FM ${num}${suffix}`;
      case "RM":
        return `RM ${num}${suffix}`;
      case "BI":
        return `Business I-${num}${suffix}`;
      case "BU":
        return `Business US-${num}${suffix}`;
    }
  }
  return name;
}
function fmtRestriction(r) {
  const type = str(r.type).toLowerCase();
  const value = Number(r.value);
  const unit = str(r.unit).toLowerCase();
  if (!type || !Number.isFinite(value) || value <= 0) return null;
  const label = type.includes("length") ? "Length limit" : type.includes("width") ? "Width limit" : type.includes("weight") || type.includes("load") ? "Weight limit" : type.includes("speed") ? "Speed limit" : type.replace(/[-_]+/g, " ");
  let amount;
  if (unit === "centimeters" || unit === "cm") amount = `${Math.round(value / 30.48)} ft`;
  else if (unit === "kilograms" || unit === "kg") amount = `${Math.round(value * 2.205)} lb`;
  else if (unit === "meters" || unit === "m") amount = `${(value / 1609.34).toFixed(1)} mi`;
  else amount = `${Math.round(value)} ${unit || ""}`.trim();
  return `${label} ${amount}`;
}
function sampledPoints(geom, maxPoints = 200) {
  const g = asRecord(geom);
  const coords = g.coordinates;
  const out = [];
  const pushPoint = (c) => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number")
      out.push([c[0], c[1]]);
  };
  const walk = (c, depth) => {
    if (!Array.isArray(c) || depth > 4) return;
    if (typeof c[0] === "number") {
      pushPoint(c);
      return;
    }
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
function simplifiedGeometry(geom) {
  const pts = sampledPoints(geom, SIMPLIFIED_GEOM_POINTS);
  if (!pts.length) return null;
  if (pts.length === 1) return { type: "Point", coordinates: pts[0] };
  return { type: "LineString", coordinates: pts };
}
function normalizeFeature(feature, row, nowMs) {
  const wrapped = asRecord(snakeKeysDeep(feature.properties));
  const props = Object.keys(wrapped).length > 0 ? wrapped : asRecord(snakeKeysDeep(feature));
  const core = coreOf(props);
  const geometry = feature.geometry ?? props.geometry;
  const id = str(feature.id) || str(props.id) || `evt-${Math.random().toString(36).slice(2, 10)}`;
  const startIso = str(props.start_date) || str(core.start_date) || null;
  const endIso = str(props.end_date) || str(core.end_date) || null;
  const updatedIso = str(props.update_date) || str(core.update_date) || str(props.last_updated) || str(core.last_updated) || str(props.last_updated_date) || str(core.last_updated_date) || str(props.updated) || str(core.updated) || str(props.creation_date) || str(core.creation_date) || null;
  const startMs = startIso ? Date.parse(startIso) : NaN;
  const endMs = endIso ? Date.parse(endIso) : NaN;
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
  const point = [sx / points.length, sy / points.length];
  const roadNames = asArray(core.road_names).map(str).filter(Boolean);
  const roadName = prettifyRoadName(roadNames[0] ?? "");
  const dirStr = str(core.direction);
  const direction = dirStr && dirStr.toLowerCase() !== "unknown" ? dirStr : null;
  const rawDesc = str(core.description);
  const description = rawDesc.split(/Full schedule below/i)[0].trim().slice(0, MAX_DESCRIPTION_CHARS);
  const lanes = asArray(props.lanes ?? core.lanes);
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
  const laneParts = [];
  if (travelLanesClosed > 0)
    laneParts.push(
      travelLanesClosed >= 3 ? "multiple lanes closed" : `${travelLanesClosed} lane${travelLanesClosed > 1 ? "s" : ""} closed`
    );
  if (shoulderLanesClosed > 0)
    laneParts.push(
      shoulderLanesClosed > 1 ? "shoulders closed" : "shoulder closed"
    );
  if (restrictedLanes > 0)
    laneParts.push(
      restrictedLanes >= 3 ? "multiple lanes restricted" : `${restrictedLanes} lane${restrictedLanes > 1 ? "s" : ""} restricted`
    );
  const laneSummary = laneParts.length ? laneParts.join("; ") : null;
  const workTypes = [
    ...new Set(
      asArray(props.types_of_work ?? core.types_of_work).map((w2) => str(w2.type_name).replace(/[-_]+/g, " ").trim()).filter(Boolean)
    )
  ].slice(0, 2);
  const workType = workTypes.length ? workTypes.map((w2) => w2.charAt(0).toUpperCase() + w2.slice(1)).join(", ") : null;
  const restrictions = asArray(props.restrictions ?? core.restrictions).map(fmtRestriction).filter((t) => Boolean(t));
  const titleParts = [roadName, direction ? direction.replace(/-/g, " ") : ""].filter(Boolean);
  const eventType = str(core.event_type).toLowerCase();
  const kind = eventKind(eventType || "work-zone");
  const status = Number.isFinite(startMs) && startMs > nowMs ? "scheduled" : "active";
  return {
    id: `${row.feedname ?? row.state ?? "feed"}:${id}`,
    state: str(row.state) || "us",
    publisher: str(row.issuingorganization) || "State DOT",
    kind,
    status,
    title: titleParts.join(" \xB7 ") || (kind === "construction" ? "Road work" : "Road event"),
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
    geometry: simplifiedGeometry(geometry)
  };
}
async function fetchJson(url, timeoutMs = FEED_TIMEOUT_MS, headers) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "StormPath-DOT-Feeds/1.0 (+https://stormpath.app)", ...headers }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_FEED_BYTES) throw new Error(`feed too large (${len} bytes)`);
  if (!res.body) return res.json();
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (; ; ) {
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
function isKeyed(row) {
  return row.needapikey === true || String(row.needapikey).toLowerCase() === "true";
}
function authFor(row, env) {
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
  const headers = cfg.header ? { [cfg.header]: `${cfg.prefix ?? ""}${key}` } : void 0;
  return { url: finalUrl, headers };
}
function stateNamesOf(raw) {
  return String(raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 1 && s !== "n/a" && s !== "us" && s !== "nps");
}
var IL_WINTER_URL = "https://services7.arcgis.com/mdhzdIvz6eXVRvAt/ArcGIS/rest/services/IL_DOT_Winter_Road_Conditions___3411962229211774331/FeatureServer/0/query?where=1%3D1&outFields=FID%2CWrcMntSect%2CCOUNTY_NAM%2CSTR_STATEC%2CCondition&f=geojson&outSR=4326&resultRecordCount=2000";
function ilWinterRoadName(code) {
  const n = parseInt(code, 10);
  return Number.isFinite(n) && n > 0 && String(n).length <= 3 ? `IL-${n}` : code;
}
function eventGeo(geometry) {
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
    geometry: simplifiedGeometry(geometry)
  };
}
function normalizeIllinoisWinter(feature) {
  const props = asRecord(feature.properties);
  const condition = str(props.Condition);
  if (!condition || condition.toLowerCase() === "clear") return null;
  const geo = eventGeo(feature.geometry);
  if (!geo) return null;
  const roadName = ilWinterRoadName(str(props.STR_STATEC));
  const county = str(props.COUNTY_NAM);
  const section = str(props.WrcMntSect).replace(/\s*\((I+)\)\s*$/, "").trim();
  const conditionLabel = condition.replace(/\s+/g, " ").trim();
  const impactSlug = conditionLabel.toLowerCase().replace(/\s+/g, "-");
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
    description: `${conditionLabel} \u2014 ${county ? `${county} County` : "Illinois"}` + (section ? ` \xB7 IDOT winter maintenance: ${section}` : ""),
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
    geometry: geo.geometry
  };
}
var IA_WINTER_URL = "https://services.arcgis.com/8lRhdTsQyJpO52F1/ArcGIS/rest/services/511_IA_Road_Conditions_View/FeatureServer/0/query?where=ROAD_CONDITION%3C%3E%27Seasonal%27&outFields=OBJECTID%2CSEGMENT_ID%2CROUTE_NAME%2CLONG_NAME%2CROAD_CONDITION%2CCARS_MSG_UPDATE_DATE&f=geojson&outSR=4326&resultRecordCount=2000";
function normalizeIowaWinter(feature) {
  const props = asRecord(feature.properties);
  const condition = str(props.ROAD_CONDITION);
  if (!condition || condition.toLowerCase() === "seasonal") return null;
  const geo = eventGeo(feature.geometry);
  if (!geo) return null;
  const roadName = prettifyRoadName(str(props.ROUTE_NAME));
  const conditionLabel = condition.replace(/\s+/g, " ").trim();
  const longName = str(props.LONG_NAME);
  const loc = roadName && longName.toLowerCase().startsWith(`${roadName.toLowerCase()},`) ? longName.slice(roadName.length + 1).trim() : longName;
  const updatedMs = Number(props.CARS_MSG_UPDATE_DATE);
  const updatedIso = Number.isFinite(updatedMs) && updatedMs > 0 ? new Date(updatedMs).toISOString() : null;
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
    description: `${conditionLabel} \u2014 Iowa DOT winter report` + (loc ? ` \xB7 ${loc.slice(0, 200)}` : ""),
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
    geometry: geo.geometry
  };
}
var MO_WINTER_URL = "https://mapping.modot.org/arcgis/rest/services/TravelerInformation/TravelerInformationMod/MapServer/26/query?where=UPPER%28ROAD_COND_CODE%29%20NOT%20IN%20%28%27CLEAR%27%2C%27MOSTLY%20CLEAR%27%29&outFields=ROAD_COND_CODE%2CLEVEL_NO%2CDATA_ID%2COBJECT_ID&f=geojson&outSR=4326&resultRecordCount=2000";
function normalizeMissouriWinter(feature) {
  const props = asRecord(feature.properties);
  const condition = str(props.ROAD_COND_CODE);
  if (!condition || condition.toLowerCase().includes("clear")) return null;
  const geo = eventGeo(feature.geometry);
  if (!geo) return null;
  const conditionLabel = condition.replace(/\s+/g, " ").trim();
  const lc = conditionLabel.toLowerCase();
  const impactSlug = lc === "covered" || lc.includes("completely covered") ? "completely-covered" : lc.includes("part") ? "partially-covered" : conditionLabel.toLowerCase().replace(/\s+/g, "-");
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
    description: `${conditionLabel} \u2014 Missouri DOT winter road conditions`,
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
    geometry: geo.geometry
  };
}
var MD_CHART_INCIDENTS_URL = "https://chartexp1.sha.maryland.gov/CHARTExportClientService/getEventMapDataJSON.do";
var MD_CHART_CLOSURES_URL = "https://chartexp1.sha.maryland.gov/CHARTExportClientService/getActiveClosureMapDataJSON.do";
function pickChartData(data) {
  return asArray(data.data);
}
function normalizeMdChartWinter(event) {
  const incidentType = str(event.incidentType);
  if (!/winter|ice|snow/i.test(incidentType)) return null;
  if (event.closed === true || event.trafficAlert === true) return null;
  const lat = Number(event.lat);
  const lon = Number(event.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const county = str(event.county);
  const direction = str(event.direction) || null;
  const desc = str(event.description);
  const label = incidentType.replace(/\s+/g, " ").trim() || "Winter condition";
  const updatedMs = Number(event.lastCachedDataUpdateTime ?? event.createTime);
  const updatedIso = Number.isFinite(updatedMs) && updatedMs > 0 ? new Date(updatedMs).toISOString() : null;
  const point = [lon, lat];
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
    description: `${label} \u2014 ${county ? `${county} County` : "Maryland"}` + (desc && !desc.toLowerCase().startsWith(label.toLowerCase()) ? ` \xB7 ${desc.slice(0, 160)}` : ""),
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
    geometry: { type: "Point", coordinates: [lon, lat] }
  };
}
var CUSTOM_FEEDS = [
  {
    name: "ilwinter",
    state: "illinois",
    publisher: "Illinois DOT",
    url: IL_WINTER_URL,
    normalize: normalizeIllinoisWinter
  },
  {
    name: "iawinter",
    state: "iowa",
    publisher: "Iowa DOT",
    url: IA_WINTER_URL,
    normalize: normalizeIowaWinter
  },
  {
    name: "mowinter",
    state: "missouri",
    publisher: "Missouri DOT",
    url: MO_WINTER_URL,
    normalize: normalizeMissouriWinter
  },
  {
    name: "mdchart-events",
    state: "maryland",
    publisher: "Maryland DOT CHART",
    url: MD_CHART_INCIDENTS_URL,
    normalize: normalizeMdChartWinter,
    pick: pickChartData
  },
  {
    name: "mdchart-closures",
    state: "maryland",
    publisher: "Maryland DOT CHART",
    url: MD_CHART_CLOSURES_URL,
    normalize: normalizeMdChartWinter,
    pick: pickChartData
  }
];
async function buildSnapshot(env) {
  const nowMs = Date.now();
  const registry = await fetchJson(REGISTRY_URL, 15e3);
  const rows = registry.filter((r) => feedUrlOf(r));
  const events = [];
  const coveredStates = /* @__PURE__ */ new Set();
  let failed = 0;
  let skippedKeyed = 0;
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
          const feed = await fetchJson(auth.url, FEED_TIMEOUT_MS, auth.headers);
          for (const s of stateNamesOf(row.state)) coveredStates.add(s);
          const fc = asArray(feed.features);
          const list = fc.length ? fc : asArray(feed.road_events);
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
  for (const feed of CUSTOM_FEEDS) {
    try {
      const data = await fetchJson(feed.url, FEED_TIMEOUT_MS);
      for (const s of stateNamesOf(feed.state)) coveredStates.add(s);
      const raw = feed.pick ? feed.pick(data) : asArray(data.features);
      const features = raw.slice(0, MAX_FEATURES_PER_FEED);
      for (const f of features) {
        const ev = feed.normalize(f);
        if (ev) events.push(ev);
      }
    } catch (err) {
      failed += 1;
      console.warn(`[dot-feeds] custom feed failed: ${feed.name}`, err);
    }
  }
  if (failed > 0) console.warn(`[dot-feeds] ${failed} feeds failed`);
  events.sort((a, b) => a.id.localeCompare(b.id));
  return { fetchedAt: nowMs, events, states: [...coveredStates].sort() };
}
async function snapshot(cachesApi) {
  const hit = await cachesApi.match(SNAPSHOT_CACHE_URL);
  if (!hit) return null;
  try {
    return await hit.json();
  } catch {
    return null;
  }
}
function isSnapshot(v) {
  const s = v;
  return !!s && typeof s.fetchedAt === "number" && Date.now() - s.fetchedAt < 60 * 6e4 && Array.isArray(s.events);
}
function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
var index_default = {
  async fetch(request, env, ctx) {
    const bindings = env ?? {};
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/ingest") {
      if (request.method !== "POST")
        return new Response("Method not allowed", { status: 405, headers: CORS });
      const auth = request.headers.get("Authorization") ?? "";
      if (!bindings.INGEST_SECRET || auth !== `Bearer ${bindings.INGEST_SECRET}`)
        return new Response("unauthorized", { status: 401, headers: CORS });
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("bad json", { status: 400, headers: CORS });
      }
      if (!isSnapshot(body))
        return new Response("bad snapshot", { status: 400, headers: CORS });
      await caches.default.put(
        SNAPSHOT_CACHE_URL,
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=240" }
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
      const snap = await snapshot(caches.default);
      return Response.json(
        {
          ok: true,
          events: snap?.events.length ?? 0,
          ageSec: snap ? Math.round((Date.now() - snap.fetchedAt) / 1e3) : null
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
        const q = [parts[0], parts[1], parts[2], parts[3]];
        events = events.filter((e) => bboxIntersects(e.bbox, q));
      }
      return Response.json(
        { fetchedAt: snap.fetchedAt, count: events.length, events },
        { headers: { ...CORS, "Cache-Control": "public, max-age=60" } }
      );
    }
    if (url.pathname === "/coverage") {
      const snap = await snapshot(caches.default);
      if (!snap) return Response.json({ error: "no snapshot" }, { status: 503, headers: CORS });
      const states = snap.states ?? [...new Set(snap.events.map((e) => e.state.trim().toLowerCase()))].sort();
      return Response.json(
        { fetchedAt: snap.fetchedAt, states },
        { headers: { ...CORS, "Cache-Control": "public, max-age=300" } }
      );
    }
    return new Response("not found", { status: 404, headers: CORS });
  }
};
export {
  buildSnapshot,
  index_default as default
};
