import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { RouteSituationSlice } from "../situation/types";
import { formatEtaDuration } from "../ui/formatEta";
import { FALLBACK_LNGLAT } from "./constants";

const WINTER_RX = /\b(snow|ice|icy|sleet|freez|blizzard|winter\s+storm|slush)\b/i;

export type RouteCompareFeedRow = {
  id: string;
  tag: string;
  text: string;
  severity: number;
  overview: boolean;
  lng: number;
  lat: number;
  zoom?: number;
};

function sliceFor(
  slices: RouteSituationSlice[] | undefined,
  routeId: string
): RouteSituationSlice | undefined {
  return slices?.find((s) => s.routeId === routeId);
}

function midPoint(coords: [number, number][] | undefined): [number, number] {
  if (coords?.length) {
    const i = Math.floor(coords.length / 2);
    const p = coords[i]!;
    return [p[0]!, p[1]!];
  }
  return FALLBACK_LNGLAT;
}

/**
 * When several routes exist and weather looks rough, add feed rows so the driver
 * can compare time vs sampled corridor conditions (OpenWeather along polylines — not live radar dBZ).
 */
export function buildRouteWeatherCompareRows(
  scored: ScoredRoute[],
  slices: RouteSituationSlice[] | undefined,
  activeRouteId: string,
  /** route id → A, B, C */
  letterByRouteId: Map<string, string>,
  geometries: Map<string, [number, number][]>
): RouteCompareFeedRow[] {
  if (scored.length < 2) return [];

  const radars = scored.map((s) => ({
    id: s.route.id,
    r: sliceFor(slices, s.route.id)?.radarIntensity ?? 0,
  }));
  const maxR = Math.max(...radars.map((x) => x.r), 0);
  const minR = Math.min(...radars.map((x) => x.r));
  const spread = maxR - minR;

  const anyWinter = scored.some((s) => {
    const head = sliceFor(slices, s.route.id)?.forecastHeadline ?? "";
    return WINTER_RX.test(head);
  });

  const activeRadar = radars.find((x) => x.id === activeRouteId)?.r ?? 0;
  const heavyWx =
    maxR >= 0.22 ||
    anyWinter ||
    (activeRadar >= 0.18 && spread >= 0.08);

  const anchor = midPoint(geometries.get(activeRouteId));
  const rows: RouteCompareFeedRow[] = [];

  const etas = scored.map((s) => s.effectiveEtaMinutes);
  const minEta = Math.min(...etas);
  const maxEta = Math.max(...etas);

  const strategyText = heavyWx
    ? "Storm / rough wx: faster legs often cut through stronger sampled precip on the corridor; slower alternates may ride the “green” on radar more. " +
      "Open Rt to pick another line before Go, use Rad overlay, or Stop to replan / delay departure. " +
      (anyWinter
        ? "Ice & snow — slow down, add following distance, consider waiting for treatment or daylight."
        : "Heavy rain — if time-flexible, waiting out the worst cells can be safer.")
    : "Each route has its own ETA and OpenWeather samples along that path (not the same as the Rad tile colors). " +
      "Switch in Rt view before Go if you want more time vs. a milder sampled corridor.";

  rows.push({
    id: "compare-strategy",
    tag: "Options",
    text: strategyText,
    severity: heavyWx ? Math.min(92, 68 + Math.round(maxR * 28)) : 38 + Math.round(maxR * 20),
    overview: true,
    lng: anchor[0]!,
    lat: anchor[1]!,
    zoom: 9.5,
  });

  const sortedByRadar = [...scored].sort(
    (a, b) =>
      (sliceFor(slices, a.route.id)?.radarIntensity ?? 0) -
      (sliceFor(slices, b.route.id)?.radarIntensity ?? 0)
  );
  const mildestId = sortedByRadar[0]?.route.id;
  const stormiestId = sortedByRadar[sortedByRadar.length - 1]?.route.id;

  for (const s of scored) {
    const letter = letterByRouteId.get(s.route.id) ?? "?";
    const sl = sliceFor(slices, s.route.id);
    const rad = sl?.radarIntensity ?? 0;
    const eta = formatEtaDuration(s.effectiveEtaMinutes);
    const head = (sl?.forecastHeadline ?? "").replace(/\s+/g, " ").trim();
    const winterHere = WINTER_RX.test(head);

    const parts: string[] = [];
    parts.push(`~${eta}${s.route.id === activeRouteId ? " · driving this leg" : ""}`);

    if (rad >= 0.45) parts.push("Strong precip signal on sampled corridor.");
    else if (rad >= 0.25) parts.push("Moderate precip on samples.");
    else if (rad >= 0.12) parts.push("Lighter sampled conditions.");
    else parts.push("Low precip weight on samples.");

    if (spread > 0.06 && s.route.id === mildestId && mildestId !== stormiestId) {
      parts.push("Mildest sampled weather among these options.");
    }
    if (spread > 0.06 && s.route.id === stormiestId && mildestId !== stormiestId) {
      parts.push("Heaviest sampled weather — consider a longer alternate if time allows.");
    }

    if (maxEta > minEta * 1.12 && s.effectiveEtaMinutes === maxEta) {
      const extra = Math.round(s.effectiveEtaMinutes - minEta);
      if (extra >= 3) {
        parts.push(`About ${formatEtaDuration(extra)} longer than the fastest option here.`);
      }
    }

    if (winterHere) {
      parts.push("Winter surface risk on this corridor — slow down, increase following distance.");
    }

    const trunc = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`);
    const tail = head ? ` Wx: ${trunc(head, 72)}` : "";
    const [lng, lat] = midPoint(geometries.get(s.route.id));

    rows.push({
      id: `compare-route-${s.route.id}`,
      tag: `Rt ${letter}`,
      text: trunc(parts.join(" ") + tail, 220),
      severity: Math.min(
        88,
        42 + Math.round(rad * 40) + (s.route.id === activeRouteId ? 6 : 0) + (winterHere ? 10 : 0)
      ),
      overview: true,
      lng,
      lat,
      zoom: 10.2,
    });
  }

  return rows;
}
