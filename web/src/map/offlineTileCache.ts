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
 * **Budget — 500 pieces total.** Deliberately matches mapbox-gl's default in-memory
 * tile cache count (see Mapbox ToS 3.2 discussion in AGENTS / Brain): roughly what
 * the SDK itself would hold anyway, split into three buckets so a route corridor
 * can't evict the home area. Tiles above z13 are never stored — Drive runs its own
 * z15–16 warm for live use, and the offline zoom clamp (offlineZoomClamp.ts) keeps
 * the camera where the saved z≤13 tiles actually paint.
 *
 *   - essentials   40   style JSON, sprites, glyphs, tilejson — the map can't boot without them
 *   - home tiles  300   z≤13 tiles intersecting the saved home bounds
 *   - corridor    160   every other z≤13 tile (route corridor warm, drive zoom-out pans)
 *
 * **Shared context:** everything here is safe in both the window main thread and a
 * classic Web Worker — no DOM-only APIs, `indexedDB` / `fetch` / `Response` /
 * `BroadcastChannel` are reached through globals. The worker entry point is
 * `mapboxOfflineWorker.ts`; the main-thread wrap lives in `mapboxCapacitorWorker.ts`.
 *
 * **Never breaks the map:** every IndexedDB error is swallowed — worst case is the
 * original fetch behavior.
 */

export const OFFLINE_MAX_STORED_ZOOM = 13;
export const OFFLINE_ESSENTIALS_MAX = 40;
export const OFFLINE_HOME_TILES_MAX = 300;
export const OFFLINE_CORRIDOR_TILES_MAX = 160;
/** Anything older than 30 days is dead weight — regions change, styles rev. */
export const OFFLINE_TILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const OFFLINE_FALLBACK_TIMEOUT_MS = 6_000;

const DB_NAME = "stormpath-offline-tiles";
const DB_VERSION = 2;
const STORE_NAME = "tiles";
const META_STORE = "meta";
const HOME_BOUNDS_META_KEY = "homeBounds";
const PUTS_BETWEEN_EVICT = 50;
const CHANNEL_NAME = "stormpath-offline-tiles";

export type LatLngBoundsLike = [[number, number], [number, number]];

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

/**
 * Parse a `/v4/<tileset[,tileset…]>/<z>/<x>/<y>[@2x].<ext>` tile URL.
 * Returns null for every other cacheable resource (style, sprite, glyph, tilejson).
 */
export function parseTileZxy(url: string): { z: number; x: number; y: number } | null {
  try {
    const path = new URL(url).pathname;
    const m = /^\/v4\/[^/]+\/(\d+)\/(\d+)\/(\d+)(?:@2x)?(?:\.[a-z0-9]+)+$/i.exec(path);
    if (!m) return null;
    return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
  } catch {
    return null;
  }
}

function tileLatForY(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Slippy-tile bbox vs `[[west,south],[east,north]]` bounds intersection. */
export function tileIntersectsBounds(
  z: number,
  x: number,
  y: number,
  bounds: LatLngBoundsLike
): boolean {
  const west = (x / 2 ** z) * 360 - 180;
  const east = ((x + 1) / 2 ** z) * 360 - 180;
  const north = tileLatForY(y, z);
  const south = tileLatForY(y + 1, z);
  const [[bw, bs], [be, bn]] = bounds;
  return west <= be && east >= bw && south <= bn && north >= bs;
}

/* ------------------------------------------------------------------ IndexedDB */

export interface TileRecord {
  key: string;
  body: ArrayBuffer;
  contentType: string;
  storedAt: number;
  lastUsed: number;
  kind: "essential" | "tile";
  z?: number;
  x?: number;
  y?: number;
}

/** Just the fields eviction / diagnostics need. */
export type TileMeta = Pick<TileRecord, "key" | "kind" | "lastUsed" | "storedAt"> & {
  z?: number;
  x?: number;
  y?: number;
};

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
      req.onupgradeneeded = (ev) => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
            store.createIndex("lastUsed", "lastUsed", { unique: false });
          } else if ((ev.oldVersion ?? 0) < 2) {
            /* v1 → v2: record shape changed (kind/zxy) and the budget shrank —
             * drop the old 6000-cap data rather than migrating it. */
            try {
              req.transaction?.objectStore(STORE_NAME).clear();
            } catch {
              /* swallow */
            }
          }
          if (!db.objectStoreNames.contains(META_STORE)) {
            db.createObjectStore(META_STORE, { keyPath: "key" });
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
    const zxy = parseTileZxy(key);
    if (zxy && zxy.z > OFFLINE_MAX_STORED_ZOOM) return;
    const now = Date.now();
    const record: TileRecord = {
      key,
      body,
      contentType,
      storedAt: now,
      lastUsed: now,
      kind: zxy ? "tile" : "essential",
      ...(zxy ? { z: zxy.z, x: zxy.x, y: zxy.y } : {}),
    };
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(record);
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
    if (record && Date.now() - record.storedAt > OFFLINE_TILE_MAX_AGE_MS) {
      /* Mapbox ToS 3.2: never serve a device-cached resource older than 30 days. */
      try {
        db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key);
      } catch {
        /* swallow */
      }
      return null;
    }
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

/** Read every record's metadata (bodies ride along — fine at a 500-entry budget). */
async function readAllTileMeta(): Promise<TileMeta[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    return await new Promise<TileMeta[]>((resolve) => {
      const out: TileMeta[] = [];
      try {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(out);
            return;
          }
          const r = cursor.value as TileRecord;
          out.push({
            key: r.key,
            kind: r.kind ?? (parseTileZxy(r.key) ? "tile" : "essential"),
            lastUsed: r.lastUsed ?? 0,
            storedAt: r.storedAt ?? 0,
            ...(r.z != null ? { z: r.z, x: r.x, y: r.y } : {}),
          });
          cursor.continue();
        };
        req.onerror = () => resolve(out);
      } catch {
        resolve(out);
      }
    });
  } catch {
    return [];
  }
}

async function getMetaValue<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    if (!db || !db.objectStoreNames.contains(META_STORE)) return null;
    return await new Promise<T | null>((resolve) => {
      try {
        const req = db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(key);
        req.onsuccess = () => resolve((req.result as { key: string; value?: T } | undefined)?.value ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

async function setMetaValue(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    if (!db || !db.objectStoreNames.contains(META_STORE)) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(META_STORE, "readwrite");
        tx.objectStore(META_STORE).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    /* swallow */
  }
}

/** Main thread writes the home region so worker-side eviction can bucket tiles. */
export async function setOfflineHomeBounds(bounds: LatLngBoundsLike | null): Promise<void> {
  await setMetaValue(HOME_BOUNDS_META_KEY, bounds);
}

export async function getOfflineHomeBounds(): Promise<LatLngBoundsLike | null> {
  const v = await getMetaValue<LatLngBoundsLike | null>(HOME_BOUNDS_META_KEY);
  if (
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === "number"))
  ) {
    return v;
  }
  return null;
}

/**
 * Bucket + LRU eviction policy (pure). Returns the keys to delete:
 *  - anything older than OFFLINE_TILE_MAX_AGE_MS
 *  - per bucket (essentials / home / corridor), the least-recently-used beyond its max
 * A tile counts as "home" only when it intersects the saved home bounds; corridor
 * overflow never evicts home tiles.
 */
export function selectEvictions(
  records: Array<{ key: string; kind: "essential" | "tile"; z?: number; x?: number; y?: number; lastUsed: number; storedAt: number }>,
  homeBounds: LatLngBoundsLike | null,
  now: number = Date.now()
): string[] {
  const evict = new Set<string>();
  const essentials: typeof records = [];
  const home: typeof records = [];
  const corridor: typeof records = [];

  for (const r of records) {
    if (now - r.storedAt > OFFLINE_TILE_MAX_AGE_MS) {
      evict.add(r.key);
      continue;
    }
    if (r.kind !== "tile" || r.z == null || r.x == null || r.y == null) {
      essentials.push(r);
    } else if (homeBounds && tileIntersectsBounds(r.z, r.x, r.y, homeBounds)) {
      home.push(r);
    } else {
      corridor.push(r);
    }
  }

  const trim = (bucket: typeof records, max: number) => {
    if (bucket.length <= max) return;
    bucket
      .slice()
      .sort((a, b) => a.lastUsed - b.lastUsed)
      .slice(0, bucket.length - max)
      .forEach((r) => evict.add(r.key));
  };
  trim(essentials, OFFLINE_ESSENTIALS_MAX);
  trim(home, OFFLINE_HOME_TILES_MAX);
  trim(corridor, OFFLINE_CORRIDOR_TILES_MAX);
  return [...evict];
}

let putsSinceEvict = 0;
let evictRunning = false;

/** Apply {@link selectEvictions} against the live DB. Safe to call any time. */
export async function evictIfNeeded(): Promise<void> {
  if (evictRunning) return;
  evictRunning = true;
  try {
    const db = await openDb();
    if (!db) return;
    const [records, homeBounds] = await Promise.all([readAllTileMeta(), getOfflineHomeBounds()]);
    const doomed = selectEvictions(records, homeBounds);
    if (!doomed.length) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        for (const key of doomed) store.delete(key);
        tx.oncomplete = () => resolve();
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

/** Bucket sizes for the About diagnostics line. */
export async function getOfflineTileBucketCounts(): Promise<{
  home: number;
  corridor: number;
  essentials: number;
}> {
  try {
    const [records, homeBounds] = await Promise.all([readAllTileMeta(), getOfflineHomeBounds()]);
    let home = 0;
    let corridor = 0;
    let essentials = 0;
    for (const r of records) {
      if (r.kind !== "tile" || r.z == null || r.x == null || r.y == null) essentials += 1;
      else if (homeBounds && tileIntersectsBounds(r.z, r.x, r.y, homeBounds)) home += 1;
      else corridor += 1;
    }
    return { home, corridor, essentials };
  } catch {
    return { home: 0, corridor: 0, essentials: 0 };
  }
}

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
          total += (cursor.value as TileRecord | undefined)?.body?.byteLength ?? 0;
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
 * pass straight through untouched. Tiles above {@link OFFLINE_MAX_STORED_ZOOM}
 * are also passed through — never stored, never looked up (the offline zoom
 * clamp keeps the camera at z≤13 anyway, so nothing requests them while offline).
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
    const zxy = parseTileZxy(url);
    if (zxy && zxy.z > OFFLINE_MAX_STORED_ZOOM) {
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
            /* The slow network may still land — keep filling the cache. */
            void networkPromise
              .then((res) => storeResponseBody(key, res))
              .catch(() => undefined);
            resolve(cachedRecordToResponse(cached));
            return;
          }
          /* No disk copy — the network is the only hope; keep waiting on it. */
          networkPromise.then(
            (res) => {
              if (signal?.aborted) {
                reject(abortError());
                return;
              }
              storeResponseBody(key, res);
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
