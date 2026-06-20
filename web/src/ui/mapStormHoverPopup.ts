import type { Map as MapboxMap, MapboxGeoJSONFeature } from "mapbox-gl";
import { NWS_POLYGON_MAP_MAX_ZOOM } from "./mapWeatherAlertLayers";

/** No hazard hover popups when zoomed past polygon visibility (same cutoff as map layers). */
export const NWS_HOVER_POPUP_MAX_ZOOM = NWS_POLYGON_MAP_MAX_ZOOM;
/** Time to read the card before fade. */
export const NWS_HOVER_READ_MS = 4500;
export const NWS_HOVER_FADE_MS = 480;

/** Desktop / trackpad: true hover — skip on touch-primary devices. */
export function mapHoverPopupSupported(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function truncateStormHoverText(s: string, _max: number): string {
  return s.replace(/\s+/g, " ").trim();
}

export function nwsHoverPopupZoomOk(map: MapboxMap): boolean {
  return map.getZoom() <= NWS_HOVER_POPUP_MAX_ZOOM;
}

export function nwsHoverAlertKeyFromFeats(feats: MapboxGeoJSONFeature[]): string {
  const ids = new Set<string>();
  for (const f of feats) {
    const p = f.properties as Record<string, unknown> | null;
    const id = String(p?.id ?? "");
    if (id) ids.add(id);
  }
  return [...ids].sort().join("|");
}

/** Safe DOM for NWS hover popup (overlapping polygons → multiple rows). */
export function buildStormHoverPopupContent(feats: MapboxGeoJSONFeature[]): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "storm-hover-popup-inner";

  const byId = new Map<string, { event: string; severity: string; headline: string }>();
  for (const f of feats) {
    const p = f.properties as Record<string, unknown> | null;
    if (!p) continue;
    const id = String(p.id ?? "");
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      event: String(p.event ?? "Weather alert"),
      severity: String(p.severity ?? ""),
      headline: typeof p.headline === "string" ? p.headline : "",
    });
  }

  const all = [...byId.values()];
  const rows = all.slice(0, 4);
  for (const a of rows) {
    const row = document.createElement("div");
    row.className = "storm-hover-popup-row";

    const title = document.createElement("div");
    title.className = "storm-hover-popup-title";
    title.textContent = a.event;

    row.appendChild(title);
    if (a.severity) {
      const meta = document.createElement("div");
      meta.className = "storm-hover-popup-meta";
      meta.textContent = a.severity;
      row.appendChild(meta);
    }
    if (a.headline) {
      const hl = document.createElement("div");
      hl.className = "storm-hover-popup-hl";
      hl.textContent = truncateStormHoverText(a.headline, 160);
      row.appendChild(hl);
    }
    root.appendChild(row);
  }

  if (all.length > 4) {
    const more = document.createElement("div");
    more.className = "storm-hover-popup-more";
    more.textContent = `+${all.length - 4} more`;
    root.appendChild(more);
  }

  return root;
}
