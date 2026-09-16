import type { GeoJSONSource, Map as MapboxMap, SymbolLayer } from "mapbox-gl";
import type { RoadControlKind, RoadControlPoint } from "../nav/types";

export const ROAD_CONTROL_SRC = "stormpath-road-controls";
export const ROAD_CONTROL_LAYER = "stormpath-road-controls-icons";

/** Street-level only — signals are noise on a state-wide overview. */
export const ROAD_CONTROL_MIN_ZOOM = 13;

const ICON_BASE_PX = 20;
const ICON_PIXEL_RATIO = 2;

const ICON_NAME: Record<RoadControlKind, string> = {
  traffic_signal: "sp-control-signal",
  stop_sign: "sp-control-stop",
  yield_sign: "sp-control-yield",
  railway_crossing: "sp-control-rail",
};

export type RoadControlFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { kind: RoadControlKind; icon: string };
  }[];
};

export function roadControlFeatureCollection(
  points: RoadControlPoint[] | undefined | null
): RoadControlFeatureCollection {
  return {
    type: "FeatureCollection",
    features: (points ?? [])
      .filter((p) => Number.isFinite(p.lngLat[0]) && Number.isFinite(p.lngLat[1]))
      .map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lngLat[0], p.lngLat[1]] as [number, number] },
        properties: { kind: p.kind, icon: ICON_NAME[p.kind] },
      })),
  };
}

function drawControlIcon(kind: RoadControlKind): ImageData | null {
  const size = ICON_BASE_PX * ICON_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ICON_PIXEL_RATIO, ICON_PIXEL_RATIO);
  const s = ICON_BASE_PX;
  ctx.lineJoin = "round";

  if (kind === "traffic_signal") {
    /* Signal head: dark body, three lamps, so it reads at a glance while moving. */
    const w = s * 0.46;
    const h = s * 0.86;
    const x = (s - w) / 2;
    const y = (s - h) / 2;
    ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1;
    const r = w * 0.3;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const lamps = ["#f87171", "#fbbf24", "#34d399"];
    const lampR = w * 0.24;
    for (let i = 0; i < lamps.length; i++) {
      ctx.fillStyle = lamps[i]!;
      ctx.beginPath();
      ctx.arc(s / 2, y + h * (0.22 + i * 0.28), lampR, 0, Math.PI * 2);
      ctx.fill();
    }
    return ctx.getImageData(0, 0, size, size);
  }

  if (kind === "stop_sign") {
    const cx = s / 2;
    const cy = s / 2;
    const rad = s * 0.42;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      const px = cx + rad * Math.cos(a);
      const py = cy + rad * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "#dc2626";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    return ctx.getImageData(0, 0, size, size);
  }

  if (kind === "yield_sign") {
    ctx.beginPath();
    ctx.moveTo(s * 0.1, s * 0.22);
    ctx.lineTo(s * 0.9, s * 0.22);
    ctx.lineTo(s / 2, s * 0.86);
    ctx.closePath();
    ctx.fillStyle = "#fef2f2";
    ctx.fill();
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2.4;
    ctx.stroke();
    return ctx.getImageData(0, 0, size, size);
  }

  /* Railway crossing: yellow disc with a black X. */
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = "#facc15";
  ctx.fill();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.9)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(s * 0.3, s * 0.3);
  ctx.lineTo(s * 0.7, s * 0.7);
  ctx.moveTo(s * 0.7, s * 0.3);
  ctx.lineTo(s * 0.3, s * 0.7);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Images die with every style reload (day→night) — re-add whatever is missing. */
function ensureControlIcons(map: MapboxMap): void {
  for (const kind of Object.keys(ICON_NAME) as RoadControlKind[]) {
    const name = ICON_NAME[kind];
    if (map.hasImage(name)) continue;
    const data = drawControlIcon(kind);
    if (!data) continue;
    map.addImage(name, data, { pixelRatio: ICON_PIXEL_RATIO });
  }
}

/**
 * Signals / stop / yield / rail crossings along the driven corridor. Pass null to clear.
 * Sits on top so a 4 px route line cannot bury a signal head.
 */
export function applyRoadControlLayers(
  map: MapboxMap,
  points: RoadControlPoint[] | null | undefined
): void {
  const data = roadControlFeatureCollection(points);
  if (!data.features.length) {
    removeRoadControlLayers(map);
    return;
  }
  ensureControlIcons(map);

  const existing = map.getSource(ROAD_CONTROL_SRC) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data as unknown as GeoJSON.FeatureCollection);
  } else {
    map.addSource(ROAD_CONTROL_SRC, {
      type: "geojson",
      data: data as unknown as GeoJSON.FeatureCollection,
    });
  }

  if (!map.getLayer(ROAD_CONTROL_LAYER)) {
    const layer: SymbolLayer = {
      id: ROAD_CONTROL_LAYER,
      type: "symbol",
      source: ROAD_CONTROL_SRC,
      minzoom: ROAD_CONTROL_MIN_ZOOM,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 15, 0.72, 17, 0.95],
        "icon-allow-overlap": false,
        "icon-anchor": "center",
      },
      paint: {
        "icon-opacity": 0.95,
      },
    };
    map.addLayer(layer);
  }
}

export function removeRoadControlLayers(map: MapboxMap): void {
  if (map.getLayer(ROAD_CONTROL_LAYER)) map.removeLayer(ROAD_CONTROL_LAYER);
  if (map.getSource(ROAD_CONTROL_SRC)) map.removeSource(ROAD_CONTROL_SRC);
}
