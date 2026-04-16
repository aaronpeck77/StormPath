import type { RouteCompareFeedRow } from "./routeWeatherCompare";

export type RoutingLimitsAnchor = { lng: number; lat: number };

/**
 * Plain-language boundaries for what the current stack can and cannot do.
 * (ORS/Mapbox + OpenWeather samples + RainViewer tiles — not a storm-polygon router.)
 */
export function buildRoutingSystemLimitRows(opts: {
  showRadarOverlay: boolean;
  navigationStarted: boolean;
  userSpeedMps: number | null;
  /** Fused precip weight on active leg, 0–1 */
  routeRadarWeight: number;
  anchor: RoutingLimitsAnchor;
}): RouteCompareFeedRow[] {
  const { lng, lat } = opts.anchor;
  const rows: RouteCompareFeedRow[] = [];

  rows.push({
    id: "lim-engine",
    tag: "Model",
    text:
      "Road routers (ORS/Mapbox) optimize geometry, rules, and traffic — they do not read radar pixels. " +
      "Storm motion + your motion are not fed back into a live “weather graph”; auto-detours that chase cells would need custom cost fields and fast refresh.",
    severity: 34,
    overview: true,
    lng,
    lat,
    zoom: 9.2,
  });

  if (opts.showRadarOverlay) {
    rows.push({
      id: "lim-radar-loop",
      tag: "Rad loop",
      text:
        "Animated layer steps RainViewer past mosaics only (~2 h, ~10 min steps), crossfading two tile layers for smoother playback. " +
        "Not minute-by-minute live; refresh when the app reloads the manifest. Tiles are coarse (max zoom 7) vs street detail.",
      severity: 28,
      overview: false,
      lng,
      lat,
      zoom: 9,
    });
  }

  const heavy = opts.routeRadarWeight >= 0.38;
  const moving = opts.navigationStarted && (opts.userSpeedMps ?? 0) > 3;
  if (heavy && moving) {
    rows.push({
      id: "lim-storm-imminent",
      tag: "Breaks down",
      text:
        "Heavy sampled weather on your active leg while you’re moving: automatic routing often **fails in practice** — cells move faster than safe replanning, " +
        "mesh is too coarse to thread between echoes, and APIs won’t “orbit” a mesoscale storm. " +
        "Human judgment: slow, stop, delay departure, or manually pick a wider corridor / wait it out.",
      severity: Math.min(94, 62 + Math.round(opts.routeRadarWeight * 32)),
      overview: true,
      lng,
      lat,
      zoom: 8.8,
    });
  } else if (heavy) {
    rows.push({
      id: "lim-storm-plan",
      tag: "Storm",
      text:
        "Strong precip signal on sampled corridor. Before you commit: compare Rt A/B/C, watch the Rad loop, and assume routers won’t dodge new echoes. " +
        "If the system can’t buy enough lateral distance, treat “reroute” suggestions as informational only.",
      severity: 58 + Math.round(opts.routeRadarWeight * 22),
      overview: true,
      lng,
      lat,
      zoom: 9.4,
    });
  }

  return rows;
}
