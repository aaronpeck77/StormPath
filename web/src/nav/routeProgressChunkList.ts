import type { RouteAlert } from "./routeAlerts";
import { corridorHighlightHex } from "./routeAlerts";
import { abbrevNwsEvent, compactRouteOutlook, compactSegmentWx } from "./compactWxCopy";
import { chordFractionToAlongMeters } from "./routeGeometry";
import type { LngLat } from "./types";
import type { HazardKind, RouteSituationSlice } from "../situation/types";
import { normalizedAlertsForStormBandSegment } from "../weatherAlerts/nwsAsRouteAlerts";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { forecastSlicesForChunkFraction, samplesOverlappingChunk } from "./routeChunkWeather";
import { squeezeForSummary } from "./progressCalloutCopy";
import { formatDelayMinutesForUi } from "./trafficNarrative";
import { TRAFFIC_STRIP_SOFT_MINUTES } from "./constants";

export type RouteChunkCalloutItem = {
  key: string;
  title: string;
  summary: string;
  tooltip: string;
  color: string;
  alongT: number;
  alongPct: number;
  /** `route` = whole-trip context (shown outside the mile timeline). */
  scope: "segment" | "route";
  segmentStartM?: number;
  segmentEndM?: number;
};

export type RouteProgressCalloutBundle = {
  /** Top of panel — traffic / outlook for the full trip, not one mile marker. */
  routeWide: RouteChunkCalloutItem[];
  /** Timeline rows tied to a location along the polyline. */
  segments: RouteChunkCalloutItem[];
};

const MI = 1609.344;
const CHUNK_M = 100 * MI;
const MAX_WINDOW_CHUNKS = 12;
const BEHIND_CHUNKS = 1;
const MAX_NWS_PER_CHUNK = 2;

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

function bandsInSegment(
  bands: { startM: number; endM: number; lineHex: string }[],
  startM: number,
  endM: number
) {
  const lo = Math.min(startM, endM);
  const hi = Math.max(startM, endM);
  return bands.filter((b) => b.endM > lo && b.startM < hi);
}

function segmentWxOneLine(
  forecastHeadline: string,
  weatherSamples: { t: number; headline: string; precipHint: number }[] | undefined,
  geometry: LngLat[],
  startM: number,
  endM: number,
  totalM: number,
  midM: number
): string {
  const fracLo = startM / totalM;
  const fracHi = endM / totalM;
  const fromTimeline = forecastSlicesForChunkFraction(forecastHeadline, fracLo, fracHi);
  if (fromTimeline.length === 1) {
    return compactSegmentWx(fromTimeline[0]!);
  }
  if (fromTimeline.length > 1) {
    return compactSegmentWx(fromTimeline[0]!);
  }
  const segSamples = samplesOverlappingChunk(weatherSamples ?? [], geometry, startM, endM, totalM);
  if (segSamples.length > 0) {
    const s = segSamples[Math.floor(segSamples.length / 2)] ?? segSamples[0]!;
    return compactSegmentWx(s.headline, s.precipHint);
  }
  const wx = nearestWeatherSample(weatherSamples ?? [], geometry, midM);
  if (wx?.headline) return compactSegmentWx(wx.headline, wx.precipHint);
  return "";
}

/**
 * Bottom of panel = route start; top = destination. Route-wide rows render above the timeline.
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
  stormNwsAlerts?: NormalizedWeatherAlert[];
  progressTrafficLine?: string | null;
}): RouteProgressCalloutBundle {
  const {
    geometry,
    totalM,
    userAlongM,
    slice,
    weatherSamples,
    laidOutAlerts,
    stormBands,
    stripTint,
    stormNwsAlerts,
    progressTrafficLine,
  } = opts;

  const routeWide: RouteChunkCalloutItem[] = [];
  const segments: RouteChunkCalloutItem[] = [];

  if (totalM < 1 || geometry.length < 2) {
    return { routeWide, segments };
  }

  const fc = slice?.forecastHeadline?.trim() ?? "";
  const delay = slice?.trafficDelayMinutes ?? 0;
  const outlook = compactRouteOutlook(fc);

  if (progressTrafficLine) {
    routeWide.push({
      key: "route-traffic",
      scope: "route",
      title: "Whole route · traffic",
      summary: squeezeForSummary(progressTrafficLine, 100),
      tooltip: progressTrafficLine,
      color: corridorHighlightHex("traffic", Math.min(95, 50 + delay * 4)),
      alongT: 1,
      alongPct: 0,
    });
  } else if (delay >= TRAFFIC_STRIP_SOFT_MINUTES) {
    routeWide.push({
      key: "route-traffic-delay",
      scope: "route",
      title: "Whole route · traffic",
      summary: `+${formatDelayMinutesForUi(delay)} min vs free-flow`,
      tooltip: `Mapbox traffic delay for the full leg: +${formatDelayMinutesForUi(delay)} min`,
      color: corridorHighlightHex("traffic", Math.min(95, 50 + delay * 4)),
      alongT: 1,
      alongPct: 0,
    });
  }

  if (outlook) {
    routeWide.push({
      key: "route-wx-outlook",
      scope: "route",
      title: "Route outlook",
      summary: outlook,
      tooltip: fc || outlook,
      color: stripTint,
      alongT: 1,
      alongPct: 0,
    });
  }

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

  for (const ch of window) {
    const { startM, endM, midM } = ch;
    const alongT = Math.min(1, Math.max(0, midM / totalM));
    const alongPct = Math.round(alongT * 100);

    const isStart = startM < 2;
    const isEnd = endM >= totalM - 2;

    let title: string;
    if (isStart) title = `Start · ${fmtMiRange(0, Math.min(endM, totalM))}`;
    else if (isEnd) title = `End · ${fmtMiRange(startM, totalM)}`;
    else title = fmtMiRange(startM, endM);

    const wxLine = segmentWxOneLine(fc, weatherSamples, geometry, startM, endM, totalM, midM);

    const hzFull = hazardsInSegmentFull(slice?.hazards, startM, endM);
    const seriousHz = hzFull.filter((h) => isSeriousHazardKind(h.kind));
    const routineHz = hzFull.filter((h) => !isSeriousHazardKind(h.kind));

    const segAlerts = alertsInSegment(laidOutAlerts, startM, endM);
    const seriousAlerts = segAlerts.filter(isSeriousAlert);
    const routineAlerts = segAlerts.filter((a) => !isSeriousAlert(a));

    const bandsHere = bandsInSegment(stormBands, startM, endM);
    const nwsLines: string[] = [];
    for (const b of bandsHere.slice(0, MAX_NWS_PER_CHUNK)) {
      const inBand =
        stormNwsAlerts?.length && geometry.length >= 2
          ? normalizedAlertsForStormBandSegment(geometry, b.startM, b.endM, stormNwsAlerts)
          : undefined;
      const top = inBand?.[0];
      nwsLines.push(top ? abbrevNwsEvent(top.event) : "NWS");
    }

    const localBits: string[] = [];
    if (wxLine) localBits.push(wxLine);
    localBits.push(...nwsLines);
    if (routineHz.length) {
      localBits.push(
        routineHz
          .slice(0, 1)
          .map((h) => squeezeForSummary(h.summary, 48))
          .join("")
      );
    }
    if (routineAlerts.length) {
      localBits.push(
        routineAlerts
          .slice(0, 2)
          .map((a) => squeezeForSummary(a.title, 40))
          .join(" · ")
      );
    }

    const summary = localBits.length ? localBits.join(" · ") : "Clear this stretch";

    let color = stripTint;
    if (bandsHere.length) color = bandsHere[0]!.lineHex;
    else if (routineAlerts.length) {
      const top = routineAlerts.reduce((a, b) => (a.severity >= b.severity ? a : b));
      color = corridorHighlightHex(top.corridorKind, top.severity);
    } else if (routineHz.some((h) => h.kind === "lowVisibility")) {
      color = "#ea580c";
    }

    const tooltipParts = [
      title,
      summary,
      seriousAlerts.length ? `Priority:\n${seriousAlerts.map((a) => a.title).join("\n")}` : "",
    ].filter(Boolean);

    segments.push({
      key: `chunk-${startIdx}-${ch.idx}-${Math.round(startM)}`,
      scope: "segment",
      title,
      summary,
      tooltip: tooltipParts.join("\n\n"),
      color,
      alongT,
      alongPct,
      segmentStartM: startM,
      segmentEndM: endM,
    });

    for (const a of seriousAlerts) {
      const at = Math.min(1, Math.max(0, a.alongMeters / totalM));
      segments.push({
        key: `serious-alert-${a.id}-${Math.round(a.alongMeters)}`,
        scope: "segment",
        title: squeezeForSummary(a.title, 56),
        summary: squeezeForSummary(a.detail.trim(), 72),
        tooltip: a.detail.trim(),
        color: corridorHighlightHex(a.corridorKind, a.severity),
        alongT: at,
        alongPct: Math.round(at * 100),
      });
    }
    for (const h of seriousHz) {
      const am = typeof h.alongMeters === "number" && Number.isFinite(h.alongMeters) ? h.alongMeters : midM;
      const at = Math.min(1, Math.max(0, am / totalM));
      segments.push({
        key: `serious-hazard-${h.kind}-${Math.round(am)}`,
        scope: "segment",
        title: squeezeForSummary(h.summary, 56),
        summary: squeezeForSummary(h.summary, 72),
        tooltip: h.summary,
        color: "#ea580c",
        alongT: at,
        alongPct: Math.round(at * 100),
      });
    }
  }

  const remM = totalM - userAlongM;
  if (remM < CHUNK_M && remM > 80) {
    const filtered = segments.filter((it) => {
      if (it.scope !== "segment" || !it.key.startsWith("chunk-")) return true;
      const e = it.segmentEndM ?? 0;
      return e <= userAlongM + 1;
    });
    const remMi = remM / MI;
    const miLabel = remMi < 10 ? remMi.toFixed(1) : String(Math.round(remMi));
    filtered.push({
      key: `final-approach-${Math.round(userAlongM)}`,
      scope: "segment",
      title: `${miLabel} mi left`,
      summary: wxLineForFinal(fc, weatherSamples, geometry, totalM, userAlongM),
      tooltip: fc,
      color: stripTint,
      alongT: Math.min(1, (userAlongM + remM * 0.45) / totalM),
      alongPct: Math.round(Math.min(1, (userAlongM + remM * 0.45) / totalM) * 100),
    });
    segments.length = 0;
    segments.push(...filtered);
  }

  segments.sort((a, b) => b.alongT - a.alongT);
  return { routeWide, segments };
}

function wxLineForFinal(
  fc: string,
  weatherSamples: { t: number; headline: string; precipHint: number }[] | undefined,
  geometry: LngLat[],
  totalM: number,
  userAlongM: number
): string {
  const onWay = segmentWxOneLine(fc, weatherSamples, geometry, userAlongM, totalM, totalM, (userAlongM + totalM) / 2);
  const dest = forecastSlicesForChunkFraction(fc, 0.92, 1)[0];
  const destLine = dest ? compactSegmentWx(dest) : "";
  if (onWay && destLine) return `${onWay} → ${destLine}`;
  return onWay || destLine || "No forecast for this stretch";
}

export function routeChunkStepMeters(_totalM: number): number {
  return CHUNK_M;
}
