import type { MapViewMode } from "./ui/DriveMap";
import type { LngLat, TripPlan } from "./nav/types";

export type ActiveTripCacheEntry = {
  version: 1;
  savedAtMs: number;
  destLngLat: LngLat;
  destinationLabel: string;
  navigationStarted: boolean;
  viewMode: MapViewMode;
  routeSlotOrder: string[];
  previewLegIndex: number;
  plan: TripPlan;
};

const DB_NAME = "stormpath-trip-cache";
const DB_VERSION = 1;
const STORE_NAME = "activeTrips";
const ACTIVE_KEY = "active";

/** Drop snapshots older than this so stale geometry/ETAs are not revived blindly. */
export const MAX_TRIP_CACHE_AGE_MS = 72 * 60 * 60 * 1000;

const ROUTE_ROLES = new Set<string>(["fastest", "balanced", "hazardSmart"]);

function isLngLatPair(v: unknown): v is LngLat {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/** Structural guard — IndexedDB may hold damaged data after schema drift. */
export function isRestorableActiveTripEntry(
  entry: ActiveTripCacheEntry | null | undefined,
): entry is ActiveTripCacheEntry {
  if (!entry || entry.version !== 1) return false;
  if (typeof entry.savedAtMs !== "number" || !Number.isFinite(entry.savedAtMs)) return false;
  if (!isLngLatPair(entry.destLngLat)) return false;
  if (typeof entry.destinationLabel !== "string" || !entry.destinationLabel.trim()) return false;
  if (typeof entry.navigationStarted !== "boolean") return false;
  const vm = entry.viewMode;
  if (vm !== "drive" && vm !== "topdown" && vm !== "route") return false;
  if (!Array.isArray(entry.routeSlotOrder)) return false;
  if (typeof entry.previewLegIndex !== "number" || !Number.isFinite(entry.previewLegIndex)) return false;
  const plan = entry.plan;
  if (!plan || typeof plan !== "object") return false;
  if (typeof plan.originLabel !== "string" || typeof plan.destinationLabel !== "string") return false;
  const routes = plan.routes;
  if (!Array.isArray(routes) || routes.length === 0) return false;
  for (const r of routes) {
    if (!r || typeof r !== "object") return false;
    if (typeof r.id !== "string" || !r.id) return false;
    if (typeof r.label !== "string") return false;
    if (typeof r.role !== "string" || !ROUTE_ROLES.has(r.role)) return false;
    if (typeof r.baseEtaMinutes !== "number" || !Number.isFinite(r.baseEtaMinutes)) return false;
    const g = r.geometry;
    if (!Array.isArray(g) || g.length < 2) return false;
    for (const p of g) {
      if (!isLngLatPair(p)) return false;
    }
  }
  return true;
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("IndexedDB not available"));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function loadActiveTripFromCache(): Promise<ActiveTripCacheEntry | null> {
  if (!canUseIndexedDb()) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(ACTIVE_KEY);
      req.onsuccess = () => resolve((req.result as ActiveTripCacheEntry | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveActiveTripToCache(entry: ActiveTripCacheEntry): Promise<void> {
  if (!canUseIndexedDb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(entry, ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // best-effort; don't break navigation
    });
  } catch {
    // best-effort only
  }
}

export async function clearActiveTripCache(): Promise<void> {
  if (!canUseIndexedDb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort only
  }
}

