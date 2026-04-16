import type {
  DataDrivenPropertyValueSpecification,
  FillLayer,
  GeoJSONSource,
  LineLayer,
  Map as MapboxMap,
} from "mapbox-gl";

import { nwsMapKindHex, type NwsMapKind } from "../weatherAlerts/nwsMapKind";

const SRC = "weather-alerts-nws";
const FILL = "weather-alerts-nws-fill";
const LINE = "weather-alerts-nws-outline";

/** Hit-test layer for hover / identify (fill has the polygon area). */
export const WEATHER_ALERTS_NWS_FILL_LAYER_ID = FILL;

const NWS_KIND_ORDER: NwsMapKind[] = [
  "hydro",
  "winter",
  "fire",
  "convective",
  "marine",
  "wind",
  "heat",
  "vis",
];

/** When `kind` is absent or `other`, fall back to severity palette (same as pre-kind behavior). */
const NWS_SEVERITY_COLOR_MATCH: unknown[] = [
  "match",
  ["get", "severity"],
  "Extreme",
  "#991b1b",
  "Severe",
  "#ea580c",
  "Moderate",
  "#ca8a04",
  "Minor",
  "#64748b",
  "#94a3b8",
];

function nwsAlertMapColorExpr(): unknown {
  const kindPairs: unknown[] = [];
  for (const k of NWS_KIND_ORDER) {
    kindPairs.push(k, nwsMapKindHex(k));
  }
  return [
    "case",
    ["any", ["!", ["has", "kind"]], ["==", ["get", "kind"], "other"]],
    NWS_SEVERITY_COLOR_MATCH,
    ["match", ["get", "kind"], ...kindPairs, NWS_SEVERITY_COLOR_MATCH],
  ];
}

function firstVisibleRouteLineId(map: MapboxMap): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  for (const l of layers) {
    if (l.id.startsWith("route-") && l.id.endsWith("-line") && !l.id.includes("-hit")) return l.id;
  }
  return undefined;
}

const EMPTY_ALERT_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Draw NWS (or future) warning polygons under route lines.
 * When the session stays on but the feature list is empty (e.g. drive-mode filter), keep the source
 * and `setData(empty)` so Mapbox does not tear layers down — avoids visible blink on refresh/filter.
 */
export function applyWeatherAlertLayers(
  map: MapboxMap,
  collection: GeoJSON.FeatureCollection | null
): void {
  const beforeId = firstVisibleRouteLineId(map);

  if (collection == null) {
    if (map.getLayer(FILL)) map.removeLayer(FILL);
    if (map.getLayer(LINE)) map.removeLayer(LINE);
    if (map.getSource(SRC)) map.removeSource(SRC);
    return;
  }

  const hasFeatures = collection.features.length > 0;

  if (!hasFeatures) {
    const src = map.getSource(SRC) as GeoJSONSource | undefined;
    if (src) {
      src.setData(EMPTY_ALERT_FC);
      return;
    }
    return;
  }

  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: "geojson", data: collection! });
    const fillLayer: FillLayer = {
      id: FILL,
      type: "fill",
      source: SRC,
      paint: {
        "fill-color": nwsAlertMapColorExpr() as DataDrivenPropertyValueSpecification<string>,
        "fill-opacity": 0.14,
        "fill-opacity-transition": { duration: 280, delay: 0 },
      },
    };
    const lineLayer: LineLayer = {
      id: LINE,
      type: "line",
      source: SRC,
      paint: {
        "line-color": nwsAlertMapColorExpr() as DataDrivenPropertyValueSpecification<string>,
        "line-width": 1.5,
        "line-opacity": 0.75,
        "line-opacity-transition": { duration: 280, delay: 0 },
      },
    };
    if (beforeId) {
      map.addLayer(fillLayer, beforeId);
      map.addLayer(lineLayer, beforeId);
    } else {
      map.addLayer(fillLayer);
      map.addLayer(lineLayer);
    }
  } else {
    (map.getSource(SRC) as GeoJSONSource).setData(collection!);
  }
}
