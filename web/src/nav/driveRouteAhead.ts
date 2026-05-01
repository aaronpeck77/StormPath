import type { RouteAlert } from "./routeAlerts";

const MI = 1609.344;
/** Ignore corridor marks right under the puck; look a bit forward. */
const AHEAD_MIN_M = 80;

function fmtMi(m: number): string {
  if (m < 0) return "0 mi";
  const mi = m / MI;
  if (mi < 0.2) return "<0.2 mi";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

function etaAheadLabel(distM: number, totalM: number, planEtaMinutes: number | null | undefined): string | null {
  if (planEtaMinutes == null || !Number.isFinite(planEtaMinutes) || totalM <= 0) return null;
  const t = Math.max(0, Math.min(1, distM / totalM));
  const m = Math.max(1, Math.round(planEtaMinutes * t));
  if (m < 92) return `~${m} min`;
  return `~${(m / 60).toFixed(1)} hr`;
}

export type DriveAheadKind = "nws" | "traffic" | "road" | "weather" | "none";

/**
 * Reflectivity-style urgency: red (extreme) → orange → yellow → green (rain) → blue (ice/winter)
 * → clear (no flagged hazard ahead).
 */
export type DriveAheadRadarTier = "clear" | "blue" | "green" | "yellow" | "orange" | "red";

export type DriveAheadLine = {
  text: string;
  kind: DriveAheadKind;
  radarTier: DriveAheadRadarTier;
};

function norm(s: string): string {
  return s.toLowerCase();
}

/** NWS headline / band severity → radar tier. */
export function radarTierFromNwsSeverity(sev: string): DriveAheadRadarTier {
  const t = norm(sev);
  if (/\bwarning\b|severe|extreme|emergency|tornado|hurricane/.test(t)) return "red";
  if (/\bwatch\b/.test(t)) return "orange";
  if (/\badvisory\b/.test(t)) return "yellow";
  if (/statement|special\s+weather|short\s+term/.test(t)) return "green";
  return "yellow";
}

function radarTierFromWeatherAlert(title: string, severity: number): DriveAheadRadarTier {
  const t = norm(title);
  if (/ice|freez|sleet|blizzard|snow\s|winter\s|cold\s+advisory/.test(t)) return "blue";
  if (/thunder|tornado|severe|extreme|flash\s+flood|hurricane/.test(t)) return "red";
  if (/heavy\s+rain|flood\s+watch|flood\s+warning/.test(t)) return "orange";
  if (/rain|shower|drizzle|wet|precip/.test(t)) return "green";
  if (severity >= 75) return "orange";
  if (severity >= 55) return "yellow";
  return "green";
}

/** One line for drive strip: title + human detail (delay text, hazard summary, wx blurb). */
function corridorHeadlineForDriveAhead(a: RouteAlert): string {
  const detail = (a.detail ?? "").replace(/\s+/g, " ").trim();
  const ttl = (a.title ?? "").trim();

  if (a.corridorKind === "traffic") {
    if (a.id === "traffic-delay") {
      return ttl.length > 64 ? `${ttl.slice(0, 62)}…` : ttl;
    }
    if (detail && detail !== "—" && !/^clear$/i.test(detail)) {
      const d = detail.length > 42 ? `${detail.slice(0, 40)}…` : detail;
      return `${ttl} · ${d}`;
    }
    return ttl;
  }

  if (a.corridorKind === "hazard" && detail.length > 2) {
    const head = ttl.length > 22 ? `${ttl.slice(0, 20)}…` : ttl;
    const d = detail.length > 46 ? `${detail.slice(0, 44)}…` : detail;
    return `${head} — ${d}`;
  }

  if ((a.corridorKind === "weather" || a.id === "radar") && detail.length > 2) {
    const d = detail.length > 50 ? `${detail.slice(0, 48)}…` : detail;
    return `${ttl}: ${d}`;
  }

  return ttl.length > 56 ? `${ttl.slice(0, 54)}…` : ttl;
}

function radarTierFromCorridorAlert(a: RouteAlert): DriveAheadRadarTier {
  if (a.corridorKind === "traffic") {
    if (a.severity >= 78) return "orange";
    if (a.severity >= 55) return "yellow";
    return "green";
  }
  if (a.corridorKind === "hazard") {
    if (a.severity >= 82) return "red";
    if (a.severity >= 64) return "orange";
    return "yellow";
  }
  if (a.corridorKind === "weather") {
    return radarTierFromWeatherAlert(a.title, a.severity);
  }
  if (a.corridorKind === "notice") {
    return a.severity >= 50 ? "yellow" : "green";
  }
  return "yellow";
}

/**
 * One glanceable line for drive UI: nearest meaningful weather / hazard / traffic **ahead** on the polyline.
 */
export function buildDriveRouteAheadLine(opts: {
  totalM: number;
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
  stormBands: { startM: number; endM: number; severity?: string }[];
  laidOutAlerts: RouteAlert[];
}): DriveAheadLine | null {
  const { totalM, userAlongM, planEtaMinutes, stormBands, laidOutAlerts } = opts;
  if (totalM <= 1 || !Number.isFinite(userAlongM)) return null;

  const ua = Math.max(0, Math.min(totalM, userAlongM));

  const bands = [...stormBands].sort((a, b) => a.startM - b.startM);

  for (const b of bands) {
    if (ua + 15 >= b.startM && ua - 15 <= b.endM) {
      const sev = b.severity?.trim() || "Advisory";
      return {
        text: `NWS ${sev} — in this segment`,
        kind: "nws",
        radarTier: radarTierFromNwsSeverity(sev),
      };
    }
  }

  type Cand = {
    text: string;
    kind: DriveAheadKind;
    distM: number;
    pri: number;
    radarTier: DriveAheadRadarTier;
  };
  const cands: Cand[] = [];

  for (const b of bands) {
    if (b.startM <= ua + AHEAD_MIN_M * 0.25) continue;
    const d = b.startM - ua;
    if (d < AHEAD_MIN_M * 0.5) continue;
    const sev = b.severity?.trim() || "Warning";
    const eta = etaAheadLabel(d, totalM, planEtaMinutes);
    cands.push({
      text: eta
        ? `NWS ${sev} · ${fmtMi(d)} (${eta})`
        : `NWS ${sev} · ${fmtMi(d)} ahead`,
      kind: "nws",
      distM: d,
      pri: 4,
      radarTier: radarTierFromNwsSeverity(sev),
    });
  }

  for (const a of laidOutAlerts) {
    if (a.alongMeters < ua + AHEAD_MIN_M * 0.4) continue;
    const d = a.alongMeters - ua;
    if (d < AHEAD_MIN_M * 0.5) continue;
    const head = corridorHeadlineForDriveAhead(a);
    const eta = etaAheadLabel(d, totalM, planEtaMinutes);
    const kind: DriveAheadKind =
      a.corridorKind === "traffic" ? "traffic" : a.corridorKind === "hazard" ? "road" : "weather";
    const pri = a.corridorKind === "traffic" ? 3 : a.corridorKind === "hazard" ? 5 : 2;
    cands.push({
      text: eta ? `${head} · ${fmtMi(d)} (${eta})` : `${head} · ${fmtMi(d)}`,
      kind,
      distM: d,
      pri,
      radarTier: radarTierFromCorridorAlert(a),
    });
  }

  if (cands.length === 0) {
    return { text: "Ahead — no flagged hazards on your line", kind: "none", radarTier: "clear" };
  }

  cands.sort((a, b) => (a.distM !== b.distM ? a.distM - b.distM : b.pri - a.pri));
  const top = cands[0]!;
  return { text: top.text, kind: top.kind, radarTier: top.radarTier };
}

const BRIEF_MAX = 62;

/**
 * Short primary line for the drive status strip (full detail stays in Hazards panel).
 */
export function formatDriveAheadBrief(line: DriveAheadLine): string {
  if (line.kind === "none") {
    return "Ahead: no flagged hazards";
  }
  if (line.text.includes("in this segment")) {
    return "NWS — on this segment";
  }
  let s = line.text.replace(/\s*\(~[^)]+\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (s.length <= BRIEF_MAX) return s;
  return `${s.slice(0, BRIEF_MAX - 1)}…`;
}
