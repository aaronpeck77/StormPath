import type { RouteAlert } from "./routeAlerts";
import { corridorHighlightHex } from "./routeAlerts";
import { chordFractionToAlongMeters } from "./routeGeometry";
import type { LngLat } from "./types";
import type { HazardKind, RouteSituationSlice } from "../situation/types";
import { normalizedAlertsForStormBandSegment } from "../weatherAlerts/nwsAsRouteAlerts";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import {
  buildShortFinalStretchSummary,
  compactWxHeadline,
  forecastSlicesForChunkFraction,
  samplesOverlappingChunk,
} from "./routeChunkWeather";
import { buildStormBandCalloutBlock, etaMinutesIntoTrip, squeezeForSummary } from "./progressCalloutCopy";
import { formatDelayMinutesForUi } from "./trafficNarrative";

function limitWxLines(lines: string[], maxLines: number, maxChars: number): string {
  return lines
    .slice(0, maxLines)
    .map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l))
    .join("\n");
}

export type RouteChunkCalloutItem = {
  key: string;
  title: string;
  summary: string;
  tooltip: string;
  color: string;
  alongT: number;
  alongPct: number;
  /** Chunk segment along route (m) — used when replacing the tail with a final-approach row. */
  segmentStartM?: number;
  segmentEndM?: number;
};

const MI = 1609.344;
/** Progress callout chunks follow the route in 100 mi steps (per product spec). */
const CHUNK_M = 100 * MI;
const MAX_WINDOW_CHUNKS = 12;
const BEHIND_CHUNKS = 1;
/** Cap NWS polygon rows — list scrolls; prefer bands near the driver when trimming. */
const MAX_NWS_PANEL_ROWS = 28;

function fmtMiRange(startM: number, endM: number): string {
  const a = startM / MI;
  const b = endM / MI;
  const fa = a < 10 ? a.toFixed(1) : String(Math.round(a));
  const fb = b < 10 ? b.toFixed(1) : String(Math.round(b));
  return `${fa}–${fb} mi`;
}

function nearestWeatherSample(
  samples: { t: number; headline: string; precipHint: number }[],
  geometry: LngLat[],
  targetM: number
): { t: number; headline: string; precipHint: number } | null {
  if (!samples.length) return null;
  let best = samples[0]!;
  let bestD = Infinity;
  for (const s of samples) {
    const am = chordFractionToAlongMeters(geometry, s.t);
    const d = Math.abs(am - targetM);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function hazardsInSegmentFull(
  hazards: RouteSituationSlice["hazards"] | undefined,
  startM: number,
  endM: number
): RouteSituationSlice["hazards"] {
  if (!hazards?.length) return [];
  const lo = Math.min(startM, endM);
  const hi = Math.max(startM, endM);
  return hazards.filter((h) => {
    if (typeof h.alongMeters !== "number" || !Number.isFinite(h.alongMeters)) return false;
    return h.alongMeters >= lo && h.alongMeters <= hi;
  });
}

function isSeriousHazardKind(kind: HazardKind): boolean {
  return kind === "closure" || kind === "restriction" || kind === "incident";
}

function isSeriousAlert(a: RouteAlert): boolean {
  if (a.severity >= 78) return true;
  if (a.corridorKind === "hazard" && a.severity >= 60) return true;
  if (a.corridorKind === "traffic" && a.severity >= 80) return true;
  if (a.corridorKind === "weather" && a.severity >= 70) return true;
  return false;
}

function alertsInSegment(laidOut: RouteAlert[], startM: number, endM: number): RouteAlert[] {
  const lo = Math.min(startM, endM);
  const hi = Math.max(startM, endM);
  return laidOut.filter((a) => a.alongMeters >= lo && a.alongMeters <= hi);
}

/**
 * Bottom of the panel = route start; top = toward destination — use descending `alongT` sort when rendering.
 * Long routes: sliding window along the polyline following `userAlongM`.
 */
export function buildRouteChunkCalloutList(opts: {
  geometry: LngLat[];
  totalM: number;
  userAlongM: number;
  planEtaMinutes: number | null | undefined;
  slice: RouteSituationSlice | undefined;
  weatherSamples: { t: number; headline: string; precipHint: number }[] | undefined;
  laidOutAlerts: RouteAlert[];
  stormBands: { startM: number; endM: number; lineHex: string }[];
  stripTint: string;
  /** Corridor NWS alerts — used to name storm-band rows (WHAT / impacts, not just “Moderate”). */
  stormNwsAlerts?: NormalizedWeatherAlert[];
  /**
   * Same line as Road impacts & traffic (advisory) — do not re-derive from slice here.
   * When set, used on the route-start chunk instead of `Traffic delay ~N min vs free-flow`.
   */
  progressTrafficLine?: string | null;
}): RouteChunkCalloutItem[] {
  const {
    geometry,
    totalM,
    userAlongM,
    planEtaMinutes,
    slice,
    weatherSamples,
    laidOutAlerts,
    stormBands,
    stripTint,
    stormNwsAlerts,
    progressTrafficLine,
  } = opts;

  if (totalM < 1 || geometry.length < 2) return [];

  const chunkM = CHUNK_M;

  type Chunk = { startM: number; endM: number; midM: number; idx: number };
  const chunks: Chunk[] = [];
  let i = 0;
  for (;;) {
    const startM = i * chunkM;
    if (startM >= totalM - 0.5) break;
    const endM = Math.min(totalM, (i + 1) * chunkM);
    if (endM - startM < 2) break;
    chunks.push({ startM, endM, midM: (startM + endM) / 2, idx: i });
    i += 1;
  }
  if (chunks.length === 0) {
    chunks.push({ startM: 0, endM: totalM, midM: totalM / 2, idx: 0 });
  }

  const n = chunks.length;
  const userChunk = Math.min(n - 1, Math.max(0, Math.floor(Math.max(0, userAlongM) / chunkM)));
  const startIdx = Math.max(0, userChunk - BEHIND_CHUNKS);
  const endIdx = Math.min(n, startIdx + MAX_WINDOW_CHUNKS);
  const window = chunks.slice(startIdx, endIdx);

  const items: RouteChunkCalloutItem[] = [];

  for (const ch of window) {
    const { startM, endM, midM } = ch;
    const alongT = Math.min(1, Math.max(0, midM / totalM));
    const alongPct = Math.round(alongT * 100);

    const wx = nearestWeatherSample(weatherSamples ?? [], geometry, midM);
    const fc = slice?.forecastHeadline?.trim() ?? "";
    const fracLo = startM / totalM;
    const fracHi = endM / totalM;

    const fromTimeline = forecastSlicesForChunkFraction(fc, fracLo, fracHi);
    const segSamples = samplesOverlappingChunk(weatherSamples ?? [], geometry, startM, endM, totalM);
    let wxLines: string[] = [];
    if (fromTimeline.length > 0) {
      wxLines = fromTimeline;
    } else if (segSamples.length > 0) {
      wxLines = segSamples.map((s) => compactWxHeadline(s.headline)).filter(Boolean);
    } else {
      const fallback = wx?.headline?.trim() || fc;
      wxLines = fallback ? [compactWxHeadline(fallback)] : [];
    }

    const hzFull = hazardsInSegmentFull(slice?.hazards, startM, endM);
    const seriousHz = hzFull.filter((h) => isSeriousHazardKind(h.kind));
    const routineHz = hzFull.filter((h) => !isSeriousHazardKind(h.kind));

    const segAlerts = alertsInSegment(laidOutAlerts, startM, endM);
    const seriousAlerts = segAlerts.filter(isSeriousAlert);
    const routineAlerts = segAlerts.filter((a) => !isSeriousAlert(a));
    const delay = slice?.trafficDelayMinutes ?? 0;

    const etaLo = etaMinutesIntoTrip(totalM, startM, planEtaMinutes);
    const etaHi = etaMinutesIntoTrip(totalM, endM, planEtaMinutes);
    let timePart = "";
    if (etaLo != null && etaHi != null) {
      timePart =
        Math.abs(etaHi - etaLo) <= 1
          ? `~${etaLo} min`
          : `~${Math.min(etaLo, etaHi)}–${Math.max(etaLo, etaHi)} min`;
    }

    const isStart = startM < 2;
    const isEnd = endM >= totalM - 2;

    let title: string;
    if (isStart && isEnd) {
      title = `Whole route · ${fmtMiRange(0, totalM)}`;
    } else if (isStart) {
      title = "Start route";
    } else if (isEnd) {
      title = "Route end";
    } else {
      title = timePart ? `≈ ${fmtMiRange(startM, endM)} · ${timePart}` : `≈ ${fmtMiRange(startM, endM)}`;
    }

    const roadParts: string[] = [];
    if (isStart) {
      if (progressTrafficLine) {
        roadParts.push(progressTrafficLine);
      } else if (delay > 0) {
        roadParts.push(
          `+${formatDelayMinutesForUi(delay)} min vs free-flow${delay < 0.5 ? " (very small overall)" : ""}`
        );
      }
    }
    if (routineHz.length) {
      roadParts.push(routineHz.slice(0, 3).map((h) => h.summary).join("; "));
    }
    if (routineAlerts.length) {
      roadParts.push(routineAlerts.slice(0, 5).map((a) => a.title).join(", "));
    }

    const wxBlock = limitWxLines(wxLines, 5, 96);
    const secondary = roadParts.length ? roadParts.join(" · ") : "";
    const squeezed = secondary ? squeezeForSummary(secondary, 140) : "";
    const summary =
      wxBlock && squeezed ? `${wxBlock}\n\n${squeezed}` : wxBlock || squeezed || "…";

    const tooltipParts: string[] = [
      title,
      "",
      `Along route: ${Math.round(startM)}–${Math.round(endM)} m`,
      "Conditions this segment:",
      wxLines.join("\n"),
      fc ? `\nFull route timeline:\n${fc}` : "",
      delay > 0
        ? `Mapbox delay (whole route): +${formatDelayMinutesForUi(delay)} min vs free-flow`
        : "",
      hzFull.length ? `Road notices:\n${hzFull.map((h) => h.summary).join("\n")}` : "",
      segAlerts.length
        ? `Strip / map:\n${segAlerts.map((a) => `${a.title}\n${a.detail.trim()}`).join("\n\n")}`
        : "",
    ].filter(Boolean);

    const hasHazard =
      routineHz.some((h) => h.kind === "lowVisibility") ||
      routineAlerts.some((a) => a.corridorKind === "hazard");
    let color = stripTint;
    if (routineAlerts.length) {
      const top = routineAlerts.reduce((a, b) => (a.severity >= b.severity ? a : b));
      color = corridorHighlightHex(top.corridorKind, top.severity);
    } else if (hasHazard) {
      color = "#ea580c";
    }

    items.push({
      key: `chunk-${startIdx}-${ch.idx}-${Math.round(startM)}`,
      title,
      summary,
      tooltip: tooltipParts.join("\n"),
      color,
      alongT,
      alongPct,
      segmentStartM: startM,
      segmentEndM: endM,
    });

    for (const a of seriousAlerts) {
      const at = Math.min(1, Math.max(0, a.alongMeters / totalM));
      items.push({
        key: `serious-alert-${a.id}-${Math.round(a.alongMeters)}`,
        title: a.title,
        summary: squeezeForSummary(a.detail.trim(), 200),
        tooltip: [a.title, "", a.detail.trim(), segAlerts.length ? `\nSegment ${fmtMiRange(startM, endM)}` : ""]
          .filter(Boolean)
          .join("\n"),
        color: corridorHighlightHex(a.corridorKind, a.severity),
        alongT: at,
        alongPct: Math.round(at * 100),
      });
    }
    for (const h of seriousHz) {
      const am = typeof h.alongMeters === "number" && Number.isFinite(h.alongMeters) ? h.alongMeters : midM;
      const at = Math.min(1, Math.max(0, am / totalM));
      items.push({
        key: `serious-hazard-${h.kind}-${Math.round(am)}`,
        title: h.summary.slice(0, 72) + (h.summary.length > 72 ? "…" : ""),
        summary: h.summary,
        tooltip: [h.summary, "", `Segment ${fmtMiRange(startM, endM)}`].join("\n"),
        color: "#ea580c",
        alongT: at,
        alongPct: Math.round(at * 100),
      });
    }
  }

  /* Dedicated NWS polygon rows — same lineHex as the strip / map (orange = Severe, etc.). */
  if (stormBands.length > 0) {
    let bands = stormBands.slice();
    if (bands.length > MAX_NWS_PANEL_ROWS) {
      const mid = (b: { startM: number; endM: number }) => (b.startM + b.endM) / 2;
      bands.sort((a, b) => Math.abs(mid(a) - userAlongM) - Math.abs(mid(b) - userAlongM));
      bands = bands.slice(0, MAX_NWS_PANEL_ROWS);
    }
    for (const b of bands) {
      const mid = (b.startM + b.endM) / 2;
      const alongT = Math.min(1, Math.max(0, mid / totalM));
      const inBand =
        stormNwsAlerts?.length && geometry.length >= 2
          ? normalizedAlertsForStormBandSegment(geometry, b.startM, b.endM, stormNwsAlerts)
          : undefined;
      const block = buildStormBandCalloutBlock(b, totalM, planEtaMinutes, inBand);
      items.push({
        key: `nws-band-${b.startM}-${b.endM}`,
        title: block.title,
        summary: block.summary,
        tooltip: block.tooltip,
        color: b.lineHex,
        alongT,
        alongPct: Math.round(alongT * 100),
      });
    }
  }

  const remM = totalM - userAlongM;
  if (remM < CHUNK_M && remM > 80) {
    const fc = slice?.forecastHeadline?.trim() ?? "";
    const tail = buildShortFinalStretchSummary(fc, weatherSamples, geometry, totalM, userAlongM);
    const filtered: RouteChunkCalloutItem[] = [];
    for (const it of items) {
      if (!it.key.startsWith("chunk-")) {
        filtered.push(it);
        continue;
      }
      const e = it.segmentEndM ?? 0;
      if (e > userAlongM + 1) continue;
      filtered.push(it);
    }
    const remMi = remM / MI;
    const etaEnd = etaMinutesIntoTrip(totalM, totalM, planEtaMinutes);
    const etaStart = etaMinutesIntoTrip(totalM, userAlongM, planEtaMinutes);
    let timePart = "";
    if (etaStart != null && etaEnd != null) {
      timePart =
        Math.abs(etaEnd - etaStart) <= 1
          ? `~${etaEnd} min`
          : `~${Math.min(etaStart, etaEnd)}–${Math.max(etaStart, etaEnd)} min`;
    }
    const miLabel = remMi < 10 ? remMi.toFixed(1) : String(Math.round(remMi));
    const title =
      timePart && remMi >= 0.5 ? `≈ ${miLabel} mi left · ${timePart}` : `≈ ${miLabel} mi left`;
    const summary = `On the way: ${tail.onTheWay}\n\nAt arrival: ${tail.atDest}`;
    const tooltip = [title, "", "On the way:", tail.onTheWay, "", "At arrival:", tail.atDest, fc ? `\nFull route timeline:\n${fc}` : ""]
      .filter(Boolean)
      .join("\n");
    filtered.push({
      key: `final-approach-${Math.round(userAlongM)}`,
      title,
      summary,
      tooltip,
      color: stripTint,
      alongT: Math.min(1, (userAlongM + remM * 0.45) / totalM),
      alongPct: Math.round(Math.min(1, (userAlongM + remM * 0.45) / totalM) * 100),
    });
    items.length = 0;
    items.push(...filtered);
  }

  items.sort((a, b) => b.alongT - a.alongT);
  return items;
}

/** For dependency checks / tests */
export function routeChunkStepMeters(_totalM: number): number {
  return CHUNK_M;
}
