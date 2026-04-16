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

