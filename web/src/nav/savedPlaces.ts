import type { LngLat } from "./types";

export type SavedPlace = {
  id: string;
  name: string;
  lngLat: LngLat;
  createdAt: number;
};

const STORAGE_KEY = "nav-saved-places-v1";

export function loadSavedPlaces(): SavedPlace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: SavedPlace[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const name = typeof o.name === "string" ? o.name : "";
      const c = o.lngLat;
      if (!id || !name || !Array.isArray(c) || c.length < 2) continue;
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const createdAt = typeof o.createdAt === "number" ? o.createdAt : Date.now();
      out.push({ id, name, lngLat: [lng, lat], createdAt });
    }
    return out;
  } catch {
    return [];
  }
}

export function persistSavedPlaces(places: SavedPlace[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  } catch {
    /* ignore quota */
  }
}

export function newSavedPlaceId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `sp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
