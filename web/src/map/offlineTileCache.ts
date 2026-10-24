import { isAbortError } from "../utils/fetchResilient";

/**
 * Offline tile cache for the mapbox-gl web map (Map / Rt / Dr).
 *
 * **Why this exists:** GL's own Cache Storage ("mapbox-tiles") caps at 500 entries and
 * deletes each entry it reads without re-putting it; `validateOrFetch` ignores stale
 * copies entirely and always goes to `fetch()`. In a dead zone the warmed tiles are
 * therefore already gone and every tile request rejects → blank map. This module
 * wraps the global `fetch` (main thread AND the GL worker) so Mapbox map resources
 * are mirrored into IndexedDB on success and served from there when the network is
 * down or unreasonably slow.
 *
 * **Shared context:** everything here is safe in both the window main thread and a
 * classic Web Worker — no DOM-only APIs, `indexedDB` / `fetch` / `Response` /
 * `BroadcastChannel` are reached through globals. The worker entry point is
 * `mapboxOfflineWorker.ts`; the main-thread wrap lives in `mapboxCapacitorWorker.ts`.
 *
 * **Never breaks the map:** every IndexedDB error is swallowed — worst case is the
 * original fetch behavior.
 */

export const OFFLINE_TILE_MAX_ENTRIES = 6000;
export const OFFLINE_FALLBACK_TIMEOUT_MS = 6_000;

const DB_NAME = "stormpath-offline-tiles";
const DB_VERSION = 1;
const STORE_NAME = "tiles";
const PUTS_BETWEEN_EVICT = 250;
const CHANNEL_NAME = "stormpath-offline-tiles";

/** True for Mapbox map resources worth keeping offline; false for live/API data. */
export function isOfflineCacheableMapboxUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host !== "mapbox.com" && !host.endsWith(".mapbox.com")) return false;
  if (host === "events.mapbox.com") return false;
  /* Live traffic tiles must never come back stale. */
  if (url.toLowerCase().includes("traffic")) return false;
  const path = u.pathname;
  if (
    path.startsWith("/directions/") ||
    path.startsWith("/geocoding/") ||
    path.startsWith("/search/")
  ) {
    return false;
  }
  return (
    path.startsWith("/v4/") ||
    path.startsWith("/styles/v1/") ||
    path.startsWith("/fonts/v1/") ||
    path.startsWith("/raster/") ||
    path.startsWith("/models/")
  );
}

/**
 * Stable cache key: drops `access_token` and `sku` (sku changes per session, token
 * can rotate) and sorts the remaining query params so equivalent requests hit the
 * same record regardless of param order.
 */
export function offlineCacheKey(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => k !== "access_token" && k !== "sku")
      .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
    const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    return `${u.origin}${u.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ IndexedDB */

export interface TileRecord {
  key: string;
  body: ArrayBuffer;
  contentType: string;
  storedAt: number;
  lastUsed: number;
}

/** Injectable seam for tests — the default impl below talks to IndexedDB. */
export interface OfflineTileStore {
  get(key: string): Promise<Pick<TileRecord, "body" | "contentType"> | null>;
  put(key: string, body: ArrayBuffer, contentType: string): Promise<void>;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
            store.createIndex("lastUsed", "lastUsed", { unique: false });
          }
        } catch {
          /* swallow */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function putTile(key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const now = Date.now();
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put({ key, body, contentType, storedAt: now, lastUsed: now } satisfies TileRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
    putsSinceEvict += 1;
    if (putsSinceEvict >= PUTS_BETWEEN_EVICT) {
      putsSinceEvict = 0;
      void evictIfNeeded();
    }
  } catch {
    /* swallow */
  }
}

export async function getTile(key: string): Promise<TileRecord | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const record = await new Promise<TileRecord | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve((req.result as TileRecord | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (record) {
      /* Fire-and-forget LRU touch — never block the tile on a bookkeeping write. */
      void (async () => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).put({ ...record, lastUsed: Date.now() });
        } catch {
          /* swallow */
        }
      })();
    }
    return record;
  } catch {
    return null;
  }
}

export async function countTiles(): Promise<number> {
  try {
    const db = await openDb();
    if (!db) return 0;
    return await new Promise<number>((resolve) => {
      try {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  } catch {
    return 0;
  }
}

/** Sum of stored tile bytes — cursor walk, only called from the About sheet. */
export async function approxBytes(): Promise<number> {
  try {
    const db = await openDb();
    if (!db) return 0;
    return await new Promise<number>((resolve) => {
      let total = 0;
      try {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(total);
            return;
          }
          const value = cursor.value as TileRecord | undefined;
          total += value?.body?.byteLength ?? 0;
          cursor.continue();
        };
        req.onerror = () => resolve(total);
      } catch {
        resolve(total);
      }
    });
  } catch {
    return 0;
  }
}

let putsSinceEvict = 0;
let evictRunning = false;

/** Trim to 90% of {@link OFFLINE_TILE_MAX_ENTRIES}, oldest `lastUsed` first. */
export async function evictIfNeeded(): Promise<void> {
  if (evictRunning) return;
  evictRunning = true;
  try {
    const db = await openDb();
    if (!db) return;
    const count = await countTiles();
    const excess = count - OFFLINE_TILE_MAX_ENTRIES;
    if (excess <= 0) return;
    const target = count - Math.floor(OFFLINE_TILE_MAX_ENTRIES * 0.9);
    await new Promise<void>((resolve) => {
      let deleted = 0;
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).index("lastUsed").openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || deleted >= target) {
            resolve();
            return;
          }
          cursor.delete();
          deleted += 1;
          cursor.continue();
        };
        req.onerror = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    /* swallow */
  } finally {
    evictRunning = false;
  }
}

const idbTileStore: OfflineTileStore = {
  get: (key) => getTile(key),
  put: (key, body, contentType) => putTile(key, body, contentType),
};

/* ------------------------------------------------------------------ counters */

let localServed = 0;
let localStored = 0;
let receivedServed = 0;
let receivedStored = 0;

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    /* BroadcastChannel never echoes to the posting context, so each side keeps its
     * own local counts plus what it hears from the other — see getOfflineTileStats. */
    channel.onmessage = (ev: MessageEvent) => {
      const type = (ev.data as { type?: string } | undefined)?.type;
      if (type === "served") receivedServed += 1;
      else if (type === "stored") receivedStored += 1;
    };
  }
} catch {
  channel = null;
}

function postCount(type: "served" | "stored"): void {
  try {
    channel?.postMessage({ type });
  } catch {
    /* swallow */
  }
}

function noteServed(): void {
  localServed += 1;
  postCount("served");
}

function noteStored(): void {
  localStored += 1;
  postCount("stored");
}

/** Main-thread stat view: this context's counters plus what the worker reported. */
export function getOfflineTileStats(): { servedOffline: number; stored: number } {
  return {
    servedOffline: localServed + receivedServed,
    stored: localStored + receivedStored,
  };
}

/* --------------------------------------------------------------- fetch wrap */

function cachedRecordToResponse(record: Pick<TileRecord, "body" | "contentType">): Response {
  return new Response(record.body, {
    status: 200,
    headers: {
      "Content-Type": record.contentType || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

function requestUrlAndMethod(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  if (typeof Request !== "undefined" && input instanceof Request) {
    return { url: input.url, method: (init?.method ?? input.method ?? "GET").toUpperCase() };
  }
  return { url: String(input), method: (init?.method ?? "GET").toUpperCase() };
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  if (typeof Request !== "undefined" && input instanceof Request) return input.signal ?? undefined;
  return undefined;
}

/**
 * Wrap a `fetch` so Mapbox map resources survive dead zones. All other requests
 * pass straight through untouched.
 *
 * Behavior for a cacheable GET:
 *  - `navigator.onLine === false` → serve the IDB copy immediately if present,
 *    else call the network (it will fail fast and GL moves on).
 *  - Otherwise race the network against {@link OFFLINE_FALLBACK_TIMEOUT_MS}:
 *    network 200 → store a clone in IDB (async) and return the live response;
 *    network non-200 → return as-is (never cached — 206s especially);
 *    network rejects → cached copy if we have one (AbortError always rethrows);
 *    timeout → cached copy if we have one (network keeps filling the cache in the
 *    background), else keep waiting on the network.
 */
export function wrapFetchWithOfflineTiles(
  origFetch: typeof fetch,
  store: OfflineTileStore = idbTileStore
): typeof fetch {
  const safeGet = (key: string) => store.get(key).catch(() => null);

  const storeResponseBody = (key: string, res: Response): void => {
    if (res.status !== 200) return;
    const contentType = res.headers.get("content-type") ?? "";
    void res
      .clone()
      .arrayBuffer()
      .then((body) => store.put(key, body, contentType))
      .then(() => noteStored())
      .catch(() => undefined);
  };

  return function offlineTilesFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const { url, method } = requestUrlAndMethod(input, init);
    if (method !== "GET" || !isOfflineCacheableMapboxUrl(url)) {
      return origFetch(input, init);
    }
    const key = offlineCacheKey(url);
    const signal = requestSignal(input, init);
    const abortError = () => new DOMException("Aborted", "AbortError");

    /* Fully offline → answer from disk right away rather than waiting on a fetch
     * that can only fail. */
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return safeGet(key).then((cached) => {
        if (signal?.aborted) throw abortError();
        if (cached) {
          noteServed();
          return cachedRecordToResponse(cached);
        }
        return origFetch(input, init);
      });
    }

    const networkPromise = origFetch(input, init);

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        /* Timeout beat the network — disk copy wins if we have it. */
        void safeGet(key).then((cached) => {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          if (cached) {
            noteServed();
            /* A late network response is harvested by the settled branch below. */
            resolve(cachedRecordToResponse(cached));
            return;
          }
          /* No disk copy — the network is the only hope; keep waiting on it.
           * (The settled branch below already stores the body.) */
          networkPromise.then(
            (res) => {
              if (signal?.aborted) {
                reject(abortError());
                return;
              }
              resolve(res);
            },
            (e) => reject(e)
          );
        });
      }, OFFLINE_FALLBACK_TIMEOUT_MS);

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(abortError());
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      networkPromise.then(
        (res) => {
          if (settled) {
            /* Timeout already answered from disk — still harvest the late body. */
            storeResponseBody(key, res);
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          storeResponseBody(key, res);
          resolve(res);
        },
        (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          if (isAbortError(e)) {
            reject(e);
            return;
          }
          void safeGet(key).then((cached) => {
            if (signal?.aborted) {
              reject(abortError());
              return;
            }
            if (cached) {
              noteServed();
              resolve(cachedRecordToResponse(cached));
              return;
            }
            reject(e);
          });
        }
      );
    });
  };
}
