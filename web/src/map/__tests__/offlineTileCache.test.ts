import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOfflineCacheableMapboxUrl,
  offlineCacheKey,
  OFFLINE_CORRIDOR_TILES_MAX,
  OFFLINE_ESSENTIALS_MAX,
  OFFLINE_FALLBACK_TIMEOUT_MS,
  OFFLINE_HOME_TILES_MAX,
  OFFLINE_TILE_MAX_AGE_MS,
  parseTileZxy,
  selectEvictions,
  tileIntersectsBounds,
  wrapFetchWithOfflineTiles,
  type OfflineTileStore,
} from "../offlineTileCache";

const TILE_URL =
  "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/13/1/2.vector.pbf?access_token=pk.test&sku=abc";

describe("isOfflineCacheableMapboxUrl", () => {
  it("accepts vector tiles, styles, and glyphs", () => {
    expect(isOfflineCacheableMapboxUrl(TILE_URL)).toBe(true);
    expect(
      isOfflineCacheableMapboxUrl("https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=pk")
    ).toBe(true);
    expect(
      isOfflineCacheableMapboxUrl("https://api.mapbox.com/fonts/v1/mapbox/Arial%20Unicode/0-255.pbf")
    ).toBe(true);
  });

  it("rejects traffic, API calls, other hosts, and telemetry", () => {
    expect(
      isOfflineCacheableMapboxUrl(
        "https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1/14/1/2.vector.pbf?access_token=pk"
      )
    ).toBe(false);
    expect(
      isOfflineCacheableMapboxUrl("https://api.mapbox.com/directions/v5/mapbox/driving/1,2;3,4")
    ).toBe(false);
    expect(
      isOfflineCacheableMapboxUrl("https://api.mapbox.com/geocoding/v5/mapbox.places/main%20st.json")
    ).toBe(false);
    expect(
      isOfflineCacheableMapboxUrl("https://api.mapbox.com/search/v1/forward?q=coffee")
    ).toBe(false);
    expect(isOfflineCacheableMapboxUrl("https://events.mapbox.com/events/v2?access_token=pk")).toBe(
      false
    );
    expect(
      isOfflineCacheableMapboxUrl("https://api.openweathermap.org/v4/something/1/2/3.png")
    ).toBe(false);
    expect(isOfflineCacheableMapboxUrl("not a url")).toBe(false);
  });
});

describe("parseTileZxy", () => {
  it("parses vector and @2x raster tile URLs", () => {
    expect(
      parseTileZxy("https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/14/1/2.vector.pbf?access_token=pk")
    ).toEqual({ z: 14, x: 1, y: 2 });
    expect(
      parseTileZxy("https://api.mapbox.com/v4/mapbox.satellite/12/300/400@2x.jpg90?access_token=pk")
    ).toEqual({ z: 12, x: 300, y: 400 });
    /* Comma-composited tilesets parse too. */
    expect(
      parseTileZxy("https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2/10/5/6.vector.pbf")
    ).toEqual({ z: 10, x: 5, y: 6 });
  });

  it("returns null for styles, sprites, glyphs, and tilejson", () => {
    expect(parseTileZxy("https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=pk")).toBeNull();
    expect(
      parseTileZxy("https://api.mapbox.com/styles/v1/mapbox/streets-v12/sprite@2x.png?access_token=pk")
    ).toBeNull();
    expect(parseTileZxy("https://api.mapbox.com/fonts/v1/mapbox/Arial/0-255.pbf")).toBeNull();
    expect(parseTileZxy("https://api.mapbox.com/v4/mapbox.mapbox-streets-v8.json?secure&access_token=pk")).toBeNull();
  });
});

describe("tileIntersectsBounds", () => {
  /* z1 tile x=0,y=0 covers lng -180..0, lat ~0..85; x=1,y=0 covers lng 0..180. */
  it("detects inside, outside, and edge-touching", () => {
    const world = [[-180, -85], [180, 85]] as [[number, number], [number, number]];
    expect(tileIntersectsBounds(0, 0, 0, world)).toBe(true);
    expect(tileIntersectsBounds(1, 0, 0, [[-90, 10], [-10, 60]])).toBe(true);
    /* East-abutting edge counts as intersecting. */
    expect(tileIntersectsBounds(1, 0, 0, [[0, 0], [30, 60]])).toBe(true);
    /* Fully east of the tile → no. */
    expect(tileIntersectsBounds(1, 0, 0, [[0.1, 0], [30, 60]])).toBe(false);
    /* Wrong hemisphere → no. */
    expect(tileIntersectsBounds(1, 0, 0, [[30, -60], [60, -10]])).toBe(false);
  });
});

describe("selectEvictions", () => {
  const now = 1_000_000_000_000;
  const tile = (key: string, lastUsed: number, x = 0, y = 0) => ({
    key,
    kind: "tile" as const,
    z: 10,
    x,
    y,
    lastUsed,
    storedAt: now - 1000,
  });
  const essential = (key: string, lastUsed: number) => ({
    key,
    kind: "essential" as const,
    lastUsed,
    storedAt: now - 1000,
  });
  /* z10 tile x=0,y=0 sits at lat ~85.02–85.05, lng -180..-179.6 — home bounds cover it;
   * the corridor tiles at x=900,y=900 (lng ~136, lat ~-55) fall outside. */
  const homeBounds: [[number, number], [number, number]] = [[-180, 84], [-100, 86]];

  it("trims each bucket to its own max by LRU", () => {
    const essentials = Array.from({ length: OFFLINE_ESSENTIALS_MAX + 5 }, (_, i) =>
      essential(`e${i}`, i)
    );
    const homeTiles = Array.from({ length: OFFLINE_HOME_TILES_MAX + 7 }, (_, i) =>
      tile(`h${i}`, i, 0, 0)
    );
    const corridorTiles = Array.from({ length: OFFLINE_CORRIDOR_TILES_MAX + 3 }, (_, i) =>
      tile(`c${i}`, i, 900, 900)
    );
    const doomed = selectEvictions([...essentials, ...homeTiles, ...corridorTiles], homeBounds, now);
    expect(doomed).toHaveLength(5 + 7 + 3);
    /* Oldest (lowest lastUsed) are the ones dropped. */
    for (let i = 0; i < 5; i++) expect(doomed).toContain(`e${i}`);
    for (let i = 0; i < 7; i++) expect(doomed).toContain(`h${i}`);
    for (let i = 0; i < 3; i++) expect(doomed).toContain(`c${i}`);
  });

  it("corridor overflow never evicts home tiles", () => {
    const records = [
      ...Array.from({ length: OFFLINE_CORRIDOR_TILES_MAX + 50 }, (_, i) => tile(`c${i}`, i, 900, 900)),
      ...Array.from({ length: 10 }, (_, i) => tile(`h${i}`, i, 0, 0)),
    ];
    const doomed = selectEvictions(records, homeBounds, now);
    expect(doomed).toHaveLength(50);
    expect(doomed.every((k) => k.startsWith("c"))).toBe(true);
  });

  it("treats every tile as corridor when homeBounds is null", () => {
    const records = Array.from({ length: OFFLINE_CORRIDOR_TILES_MAX + 2 }, (_, i) => tile(`t${i}`, i, 0, 0));
    const doomed = selectEvictions(records, null, now);
    expect(doomed).toEqual(["t0", "t1"]);
  });

  it("evicts anything older than the max age regardless of bucket", () => {
    const old = { ...essential("old", 999), storedAt: now - OFFLINE_TILE_MAX_AGE_MS - 1 };
    const doomed = selectEvictions([old], homeBounds, now);
    expect(doomed).toEqual(["old"]);
  });
});

describe("offlineCacheKey", () => {
  it("strips access_token and sku, keeps other params sorted", () => {
    const key = offlineCacheKey(
      "https://api.mapbox.com/v4/t/1.pbf?b=2&sku=xyz&access_token=pk.secret&a=1"
    );
    expect(key).toBe("https://api.mapbox.com/v4/t/1.pbf?a=1&b=2");
    expect(key).not.toContain("access_token");
    expect(key).not.toContain("sku");
  });

  it("is stable across param order", () => {
    const a = offlineCacheKey("https://api.mapbox.com/v4/t/1.pbf?x=1&y=2&access_token=t");
    const b = offlineCacheKey("https://api.mapbox.com/v4/t/1.pbf?y=2&x=1&sku=s&access_token=t");
    expect(a).toBe(b);
  });
});

describe("wrapFetchWithOfflineTiles", () => {
  function makeStore(record: { body: ArrayBuffer; contentType: string } | null = null) {
    const store: OfflineTileStore = {
      get: vi.fn(async () => record),
      put: vi.fn(async () => undefined),
    };
    return store;
  }

  const okResponse = (body = "tile-bytes") =>
    new Response(body, { status: 200, headers: { "Content-Type": "application/x-protobuf" } });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes non-cacheable requests straight through", async () => {
    const orig = vi.fn(async () => okResponse());
    const store = makeStore();
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    const res = await wrapped("https://api.openweathermap.org/data/2.5/weather");
    expect(res.status).toBe(200);
    expect(orig).toHaveBeenCalledTimes(1);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("passes non-GET requests straight through", async () => {
    const orig = vi.fn(async () => okResponse());
    const store = makeStore();
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    await wrapped(TILE_URL, { method: "POST" });
    expect(orig).toHaveBeenCalledTimes(1);
    expect(store.get).not.toHaveBeenCalled();
  });

  it("stores a 200 network response and returns it", async () => {
    const orig = vi.fn(async () => okResponse("live"));
    const store = makeStore();
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    const res = await wrapped(TILE_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("live");
    await vi.waitFor(() => expect(store.put).toHaveBeenCalledTimes(1));
    const [key, body, contentType] = (store.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe(offlineCacheKey(TILE_URL));
    expect(new TextDecoder().decode(body)).toBe("live");
    expect(contentType).toBe("application/x-protobuf");
  });

  it("does not store non-200 responses", async () => {
    const orig = vi.fn(async () => new Response("partial", { status: 206 }));
    const store = makeStore();
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    const res = await wrapped(TILE_URL);
    expect(res.status).toBe(206);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.put).not.toHaveBeenCalled();
  });

  it("serves the cached copy when the network rejects", async () => {
    const cachedBody = new TextEncoder().encode("cached-tile").buffer;
    const store = makeStore({ body: cachedBody, contentType: "application/x-protobuf" });
    const orig = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    const res = await wrapped(TILE_URL);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("cached-tile");
    expect(store.get).toHaveBeenCalledWith(offlineCacheKey(TILE_URL));
  });

  it("rethrows the network error when there is no cached copy", async () => {
    const store = makeStore(null);
    const err = new TypeError("fetch failed");
    const orig = vi.fn(async () => Promise.reject(err));
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    await expect(wrapped(TILE_URL)).rejects.toBe(err);
  });

  it("rethrows AbortError without touching the cache", async () => {
    const cachedBody = new TextEncoder().encode("cached-tile").buffer;
    const store = makeStore({ body: cachedBody, contentType: "application/x-protobuf" });
    const orig = vi.fn(async () =>
      Promise.reject(new DOMException("Aborted", "AbortError"))
    );
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    await expect(wrapped(TILE_URL)).rejects.toMatchObject({ name: "AbortError" });
    expect(store.get).not.toHaveBeenCalled();
  });

  it("serves the cached copy when the network stalls past the timeout", async () => {
    vi.useFakeTimers();
    const cachedBody = new TextEncoder().encode("cached-tile").buffer;
    const store = makeStore({ body: cachedBody, contentType: "application/x-protobuf" });
    const orig = vi.fn(() => new Promise<Response>(() => undefined)); // never resolves
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    const promise = wrapped(TILE_URL);
    await vi.advanceTimersByTimeAsync(OFFLINE_FALLBACK_TIMEOUT_MS + 100);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("cached-tile");
  });

  it("keeps waiting on the network after the timeout when nothing is cached", async () => {
    vi.useFakeTimers();
    const store = makeStore(null);
    let resolveNet: ((r: Response) => void) | null = null;
    const orig = vi.fn(() => new Promise<Response>((r) => (resolveNet = r)));
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    const promise = wrapped(TILE_URL);
    await vi.advanceTimersByTimeAsync(OFFLINE_FALLBACK_TIMEOUT_MS + 100);
    resolveNet!(okResponse("late"));
    const res = await promise;
    expect(await res.text()).toBe("late");
  });

  it("stores a z13 tile but never stores or looks up a z14 tile", async () => {
    const z13 = "https://api.mapbox.com/v4/mapbox.streets/13/1/2.vector.pbf?access_token=pk";
    const z14 = "https://api.mapbox.com/v4/mapbox.streets/14/1/2.vector.pbf?access_token=pk";
    const orig = vi.fn(async () => okResponse("t"));
    const store = makeStore({ body: new TextEncoder().encode("c").buffer, contentType: "application/x-protobuf" });
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    await wrapped(z13);
    await vi.waitFor(() => expect(store.put).toHaveBeenCalledTimes(1));
    /* z14: straight passthrough — no lookup, no store. */
    await wrapped(z14);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.get).not.toHaveBeenCalled();
  });

  it("accepts a Request object input", async () => {
    const orig = vi.fn(async () => okResponse());
    const store = makeStore();
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    const res = await wrapped(new Request(TILE_URL));
    expect(res.status).toBe(200);
    expect(store.get).not.toHaveBeenCalled(); // network won, no fallback lookup needed
  });
});
