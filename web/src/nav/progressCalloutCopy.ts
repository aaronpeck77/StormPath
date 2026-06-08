import type { RouteAlert } from "./routeAlerts";
import type { HazardKind } from "../situation/types";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import { nwsWhatIsHappening, nwsWhatToDo } from "../weatherAlerts/nwsDriveSummary";
import { displayText } from "../utils/displayText";
import { formatDelayMinutesForUi } from "./trafficNarrative";
import { radarEchoTierLabel } from "./radarReflectivityScale";
import { formatEtaDuration } from "../ui/formatEta";

/** Panel summary — full message (whitespace normalized only). */
export function squeezeForSummary(text: string, _max?: number): string {
  return displayText(text);
}

function hazardKindShortTitle(kind: HazardKind): string {
  switch (kind) {
    case "closure":
      return "Closure ahead";
    case "restriction":
      return "Lane restriction";
    case "incident":
      return "Incident ahead";
    case "lowVisibility":
      return "Low visibility";
  }
}

/** True when two notice strings describe the same Mapbox / route event. */
export function noticesMatch(a: string, b: string): boolean {
  const x = displayText(a).toLowerCase();
  const y = displayText(b).toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Split a route notice into a short panel title and a longer body line.
 * Mapbox notices use "Type — on Road — description" segments.
 */
export function splitRouteNoticeCallout(
  notice: string,
  kind?: HazardKind
): { title: string; summary: string } {
  const raw = displayText(notice);
  if (!raw) {
    return { title: kind ? hazardKindShortTitle(kind) : "Road notice", summary: "" };
  }

  const parts = raw
    .split(" — ")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      title: squeezeForSummary(parts[0]!, 56),
      summary: squeezeForSummary(parts.slice(1).join(" — "), 72),
    };
  }

  const kindTitle = kind ? hazardKindShortTitle(kind) : "";
  if (kindTitle && raw.toLowerCase() !== kindTitle.toLowerCase()) {
    return { title: kindTitle, summary: squeezeForSummary(raw, 72) };
  }

  return { title: squeezeForSummary(raw, 56), summary: "" };
}

/** Distance along the polyline from the route start (not remaining). */
export function formatAlongFromStart(m: number): string {
  if (!Number.isFinite(m) || m < 0) return "—";
  if (m < 1609) return `${Math.round(m)} m from route start`;
  const mi = m / 1609.344;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi from route start`;
}

/** Plan ETA minutes at a point along the route (uniform-speed approximation). */
export function etaMinutesIntoTrip(
  totalM: number,
  alongM: number,
  planEtaMinutes: number | null | undefined
): number | null {
  if (
    planEtaMinutes == null ||
    !Number.isFinite(planEtaMinutes) ||
    planEtaMinutes <= 0 ||
    totalM <= 0
  ) {
    return null;
  }
  const t = Math.max(0, Math.min(1, alongM / totalM));
  return Math.max(0, Math.round(planEtaMinutes * t));
}

export function etaRangeIntoTripLine(
  totalM: number,
  startM: number,
  endM: number,
  planEtaMinutes: number | null | undefined
): string | null {
  const lo = etaMinutesIntoTrip(totalM, Math.min(startM, endM), planEtaMinutes);
  const hi = etaMinutesIntoTrip(totalM, Math.max(startM, endM), planEtaMinutes);
  if (lo == null || hi == null) return null;
  if (Math.abs(hi - lo) <= 1) return `~${formatEtaDuration(lo)} into trip (plan ETA)`;
  return `~${formatEtaDuration(Math.min(lo, hi))}–${formatEtaDuration(Math.max(lo, hi))} into trip (plan ETA)`;
}

function corridorKindLabel(kind: RouteAlert["corridorKind"]): string {
  switch (kind) {
    case "weather":
      return "Weather";
    case "hazard":
      return "Road / work zone";
    case "traffic":
      return "Traffic";
    default:
      return "Notice";
  }
}

export type ProgressCalloutBlock = {
  title: string;
  /** Single readable line for the panel body (no overlap layout). */
  summary: string;
  /** Full text for hover / long-press tooltip. */
  tooltip: string;
};

/**
 * Corridor / NWS strip alert: compact summary + full detail in tooltip.
 */
export function buildCorridorCalloutBlock(
  a: RouteAlert,
  opts: {
    totalM: number;
    planEtaMinutes: number | null | undefined;
    trafficDelayMinutes?: number | null;
    forecastHeadline?: string | null;
    radarIntensity?: number | null;
  }
): ProgressCalloutBlock {
  const kind = corridorKindLabel(a.corridorKind);
  const title = `${kind} · ${a.title.trim() || "Alert"}`;

  const detail = a.detail?.trim() ?? "";
  const pos = formatAlongFromStart(a.alongMeters);
  const eta = etaMinutesIntoTrip(opts.totalM, a.alongMeters, opts.planEtaMinutes);
  const when = eta != null ? `${pos} · ~${formatEtaDuration(eta)} into trip` : pos;

  const bits: string[] = [when];
  if (detail) bits.push(detail);

  if (a.corridorKind === "weather") {
    const fc = opts.forecastHeadline?.trim();
    if (fc) bits.push(`Forecast along corridor: ${fc}`);
    const ri = opts.radarIntensity;
    const tier = ri != null ? radarEchoTierLabel(ri) : null;
    if (tier) bits.push(`Radar: ${tier}`);
  }

  if (a.corridorKind === "traffic") {
    const d = opts.trafficDelayMinutes;
    if (d != null && Number.isFinite(d) && d > 0) {
      bits.push(`Delay vs free-flow: +${formatDelayMinutesForUi(d)}`);
    }
  }

  const tooltip = bits.join("\n\n");
  const summaryCore = [when, detail].filter(Boolean).join(" — ");
  const summary = squeezeForSummary(summaryCore);

  return { title, summary, tooltip };
}

export function buildStormBandCalloutBlock(
  band: { startM: number; endM: number; severity?: string },
  totalM: number,
  planEtaMinutes: number | null | undefined,
  nwsInBand?: NormalizedWeatherAlert[]
): ProgressCalloutBlock {
  const sev = band.severity?.trim();
  const top = nwsInBand?.[0];
  const what = top ? nwsWhatIsHappening(top) : "";
  const todo = top ? nwsWhatToDo(top) : "";
  const title =
    top != null
      ? squeezeForSummary(`${top.event.trim() || "NWS"} — ${what}`, 96)
      : sev
        ? `NWS · ${sev} on route`
        : "NWS warning on route";
  const span = `${formatAlongFromStart(band.startM)} → ${formatAlongFromStart(band.endM)}`;
  const etaLine = etaRangeIntoTripLine(totalM, band.startM, band.endM, planEtaMinutes);
  const tooltip = [
    top != null
      ? [`Event: ${top.event.trim()}`, what, todo].filter(Boolean).join("\n\n")
      : "National Weather Service polygon overlaps this segment of your route.",
    `Along route: ${span}`,
    etaLine ?? "",
    "Open Hazards for the full bulletin text.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const summary = squeezeForSummary(
    [
      top != null ? what : `NWS ${sev ?? "alert"}`,
      span,
      etaLine ?? "",
    ]
      .filter(Boolean)
      .join(" · ")
  );

  return { title, summary, tooltip };
}

/** Status / fallback rows — one line in the panel, full text in tooltip. */
export function buildSimpleCalloutBlock(title: string, lines: string[]): ProgressCalloutBlock {
  const tooltip = lines.join("\n\n");
  const summary = squeezeForSummary(lines.join(" — "));
  return { title, summary, tooltip };
}
