import type { LngLat, RouteTurnStep } from "./types";

export type SavedRoute = {
  id: string;
  name: string;
  destinationLngLat: LngLat;
  destinationLabel: string;
  /** First point of the recorded path — used as destination label when traveling the path in reverse. */
  startLabel?: string;
  geometry: LngLat[];
  turnSteps?: RouteTurnStep[];
  createdAt: number;
};

const STORAGE_KEY = "nav-saved-routes-v1";

function isLngLat(v: unknown): v is LngLat {
  return Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
}

export function loadSavedRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: SavedRoute[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const name = typeof o.name === "string" ? o.name : "";
      const destinationLabel = typeof o.destinationLabel === "string" ? o.destinationLabel : "";
      const startLabel = typeof o.startLabel === "string" ? o.startLabel : undefined;
      if (!id || !name) continue;
      if (!isLngLat(o.destinationLngLat)) continue;
      const g = o.geometry;
      if (!Array.isArray(g) || g.length < 2) continue;
      const geometry: LngLat[] = [];
      for (const p of g) {
        if (isLngLat(p)) geometry.push([p[0]!, p[1]!]);
      }
      if (geometry.length < 2) continue;
      let turnSteps: RouteTurnStep[] | undefined;
      if (Array.isArray(o.turnSteps)) {
        turnSteps = [];
        for (const s of o.turnSteps) {
          if (!s || typeof s !== "object") continue;
          const t = s as Record<string, unknown>;
          const instruction = typeof t.instruction === "string" ? t.instruction : "";
          if (!instruction) continue;
          const step: RouteTurnStep = { instruction };
          if (typeof t.distanceM === "number") step.distanceM = t.distanceM;
          if (typeof t.type === "number") step.type = t.type;
          turnSteps.push(step);
        }
        if (turnSteps.length === 0) turnSteps = undefined;
      }
      const createdAt = typeof o.createdAt === "number" ? o.createdAt : Date.now();
      out.push({
        id,
        name,
        destinationLngLat: o.destinationLngLat,
        destinationLabel: destinationLabel || "Destination",
        startLabel,
        geometry,
        turnSteps,
        createdAt,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function persistSavedRoutes(routes: SavedRoute[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
  } catch {
    /* quota */
  }
}

export function newSavedRouteId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `sr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
