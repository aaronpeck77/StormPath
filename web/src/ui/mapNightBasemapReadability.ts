import type { Map } from "mapbox-gl";

function isStormPathLayerId(id: string): boolean {
  return (
    id.startsWith("route-") ||
    id.includes("rainviewer") ||
    id.startsWith("weather-alerts") ||
    id === "3d-buildings"
  );
}

function parseHexColor(hex: string): [number, number, number] | null {
  const h = hex.trim();
  if (!h.startsWith("#")) return null;
  const raw = h.slice(1);
  if (raw.length === 3) {
    return [
      Number.parseInt(raw[0]! + raw[0]!, 16),
      Number.parseInt(raw[1]! + raw[1]!, 16),
      Number.parseInt(raw[2]! + raw[2]!, 16),
    ];
  }
  if (raw.length === 6) {
    return [
      Number.parseInt(raw.slice(0, 2), 16),
      Number.parseInt(raw.slice(2, 4), 16),
      Number.parseInt(raw.slice(4, 6), 16),
    ];
  }
  return null;
}

/** Mix a hex color toward white (0 = unchanged, 1 = white). */
export function lightenHexColor(hex: string, towardWhite: number): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  const t = Math.max(0, Math.min(1, towardWhite));
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(rgb[0]))}${toHex(mix(rgb[1]))}${toHex(mix(rgb[2]))}`;
}

const NIGHT_LABEL_TEXT = "#f1f5f9";
const NIGHT_LABEL_HALO = "rgba(0, 0, 0, 0.92)";
const NIGHT_LABEL_HALO_WIDTH = 1.7;

/** Mapbox road layers use data-driven paint — override with explicit bright colors by layer id. */
export function nightRoadLineColorForLayerId(layerId: string): string {
  const id = layerId.toLowerCase();
  if (id.includes("motorway") || id.includes("trunk")) return "#fde68a";
  if (id.includes("primary")) return "#f8fafc";
  if (id.includes("secondary") || id.includes("tertiary")) return "#e8eef4";
  if (id.includes("street") || id.includes("minor")) return "#d1dae4";
  if (id.includes("service") || id.includes("link")) return "#b8c4d4";
  if (id.includes("path") || id.includes("pedestrian") || id.includes("cycle")) return "#8b9bb0";
  return "#cdd6e0";
}

export function nightRoadFillColorForLayerId(layerId: string): string {
  const id = layerId.toLowerCase();
  if (id.includes("motorway") || id.includes("trunk")) return "#57534e";
  if (id.includes("primary")) return "#475569";
  if (id.includes("secondary") || id.includes("tertiary")) return "#3d4a5c";
  return "#334155";
}

function isBasemapRoadLayer(layer: { id: string; type: string }): boolean {
  if (layer.type !== "line" && layer.type !== "fill") return false;
  const src = "source" in layer ? (layer as { source?: string }).source : undefined;
  const sourceLayer =
    "source-layer" in layer ? (layer as { "source-layer"?: string })["source-layer"] : undefined;
  if (src !== "composite" || sourceLayer !== "road") return false;
  const lid = layer.id.toLowerCase();
  if (lid.includes("traffic") || lid.includes("route") || lid.includes("rail")) return false;
  return true;
}

function brightenRoadLineLayer(map: Map, layerId: string): void {
  map.setPaintProperty(layerId, "line-opacity", 1);
  map.setPaintProperty(layerId, "line-color", nightRoadLineColorForLayerId(layerId));
  try {
    const width = map.getPaintProperty(layerId, "line-width");
    if (typeof width === "number" && width > 0) {
      map.setPaintProperty(layerId, "line-width", width * 1.22);
    }
  } catch {
    /* zoom-interpolated width */
  }
}

function brightenRoadFillLayer(map: Map, layerId: string): void {
  const id = layerId.toLowerCase();
  const casing = id.includes("case") || id.includes("casing");
  map.setPaintProperty(layerId, "fill-opacity", casing ? 0.72 : 0.58);
  map.setPaintProperty(layerId, "fill-color", nightRoadFillColorForLayerId(layerId));
}

/**
 * Brighten Mapbox dark / navigation-night basemap roads and labels for legibility.
 * Skipped when the night preset is `streets` (already a light tile set).
 */
export function applyNightBasemapReadability(map: Map): void {
  const layers = map.getStyle()?.layers;
  if (!layers) return;

  for (const layer of layers) {
    if (isStormPathLayerId(layer.id)) continue;

    if (layer.type === "symbol") {
      const layout = layer.layout as Record<string, unknown> | undefined;
      const hasText = layout?.["text-field"] != null;
      const hasIcon = layout?.["icon-image"] != null;
      if (!hasText && !hasIcon) continue;
      try {
        if (hasText) {
          map.setPaintProperty(layer.id, "text-opacity", 1);
          map.setPaintProperty(layer.id, "text-color", NIGHT_LABEL_TEXT);
          map.setPaintProperty(layer.id, "text-halo-color", NIGHT_LABEL_HALO);
          map.setPaintProperty(layer.id, "text-halo-width", NIGHT_LABEL_HALO_WIDTH);
        }
        if (hasIcon) {
          map.setPaintProperty(layer.id, "icon-opacity", 1);
        }
      } catch {
        /* data-driven paint */
      }
      continue;
    }

    if (!isBasemapRoadLayer(layer)) continue;

    try {
      if (layer.type === "line") {
        brightenRoadLineLayer(map, layer.id);
      } else if (layer.type === "fill") {
        brightenRoadFillLayer(map, layer.id);
      }
    } catch {
      /* style race */
    }
  }
}
