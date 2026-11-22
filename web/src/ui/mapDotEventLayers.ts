/**
 * DOT / WZDx construction triangles as Mapbox symbol layers.
 * HTML Markers drift off the WebGL route line at low zoom; symbols share the
 * route's render path and stay glued at every zoom.
 */
import type {
  GeoJSONSource,
  Map as MapboxMap,
  PointLike,
  SymbolLayer,
} from "mapbox-gl";
import type { DotMarkerInput } from "./dotMarkerPlacement";
import { isValidLngLatPair } from "./mapCameraSafe";

export const DOT_EVENT_SRC = "stormpath-dot-events";
export const DOT_EVENT_LAYER = "stormpath-dot-events-icons";

const ICON_BASE_PX = 18;
const ICON_PIXEL_RATIO = 2;

export type DotEventKind = NonNullable<DotMarkerInput["kind"]>;

const ICON_NAME: Record<DotEventKind, string> = {
  construction: "sp-dot-construction",
  closure: "sp-dot-closure",
  incident: "sp-dot-incident",
  other: "sp-dot-other",
};

const KIND_COLOR: Record<DotEventKind, string> = {
  construction: "#f5a524",
  closure: "#e5484d",
  incident: "#f76b15",
  other: "#8b8d98",
};

export type DotEventFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: {
      id: string;
      kind: DotEventKind;
      icon: string;
      label: string;
    };
  }[];
};

export function dotEventIconName(kind: DotEventKind | undefined): string {
  return ICON_NAME[kind ?? "other"];
}

export function dotEventFeatureCollection(
  markers: readonly DotMarkerInput[] | null | undefined
): DotEventFeatureCollection {
  return {
    type: "FeatureCollection",
    features: (markers ?? [])
      .filter((m) => isValidLngLatPair(m.lngLat))
      .map((m) => {
        const kind: DotEventKind = m.kind ?? "other";
        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [m.lngLat[0], m.lngLat[1]] as [number, number],
          },
          properties: {
            id: m.id,
            kind,
            icon: ICON_NAME[kind],
            label: m.label,
          },
        };
      }),
  };
}

function drawTriangleIcon(kind: DotEventKind): ImageData | null {
  const size = ICON_BASE_PX * ICON_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ICON_PIXEL_RATIO, ICON_PIXEL_RATIO);
  const s = ICON_BASE_PX;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.08);
  ctx.lineTo(s * 0.92, s * 0.9);
  ctx.lineTo(s * 0.08, s * 0.9);
  ctx.closePath();
  ctx.fillStyle = KIND_COLOR[kind];
  ctx.fill();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  /* Bang mark — reads as hazard without needing text glyphs. */
  ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.34);
  ctx.lineTo(s * 0.56, s * 0.62);
  ctx.lineTo(s * 0.44, s * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.74, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** Images die with every style reload (day→night) — re-add whatever is missing. */
function ensureDotEventIcons(map: MapboxMap): void {
  for (const kind of Object.keys(ICON_NAME) as DotEventKind[]) {
    const name = ICON_NAME[kind];
    if (map.hasImage(name)) continue;
    const data = drawTriangleIcon(kind);
    if (!data) continue;
    map.addImage(name, data, { pixelRatio: ICON_PIXEL_RATIO });
  }
}

/**
 * Corridor DOT triangles. Pass null/empty to clear. Sits above the route line
 * so a thick casing cannot bury the icon.
 */
export function applyDotEventLayers(
  map: MapboxMap,
  markers: readonly DotMarkerInput[] | null | undefined
): void {
  const data = dotEventFeatureCollection(markers);
  if (!data.features.length) {
    removeDotEventLayers(map);
    return;
  }
  ensureDotEventIcons(map);

  const existing = map.getSource(DOT_EVENT_SRC) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data as unknown as GeoJSON.FeatureCollection);
  } else {
    map.addSource(DOT_EVENT_SRC, {
      type: "geojson",
      data: data as unknown as GeoJSON.FeatureCollection,
      tolerance: 0,
    });
  }

  if (!map.getLayer(DOT_EVENT_LAYER)) {
    const layer: SymbolLayer = {
      id: DOT_EVENT_LAYER,
      type: "symbol",
      source: DOT_EVENT_SRC,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          0.55,
          8,
          0.75,
          12,
          0.95,
          16,
          1.1,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
      },
      paint: {
        "icon-opacity": 0.96,
      },
    };
    map.addLayer(layer);
  }
}

export function removeDotEventLayers(map: MapboxMap): void {
  if (map.getLayer(DOT_EVENT_LAYER)) map.removeLayer(DOT_EVENT_LAYER);
  if (map.getSource(DOT_EVENT_SRC)) map.removeSource(DOT_EVENT_SRC);
}

/** True when a map point hits a DOT triangle (for dest-tap / click guards). */
export function dotEventIdAtPoint(
  map: MapboxMap,
  point: PointLike
): string | null {
  if (!map.getLayer(DOT_EVENT_LAYER)) return null;
  try {
    const feats = map.queryRenderedFeatures(point, { layers: [DOT_EVENT_LAYER] });
    const id = feats[0]?.properties?.id;
    return typeof id === "string" && id.length ? id : null;
  } catch {
    return null;
  }
}
