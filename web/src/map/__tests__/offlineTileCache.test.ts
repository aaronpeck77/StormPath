import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOfflineCacheableMapboxUrl,
  offlineCacheKey,
  OFFLINE_FALLBACK_TIMEOUT_MS,
  wrapFetchWithOfflineTiles,
  type OfflineTileStore,
} from "../offlineTileCache";

const TILE_URL =
  "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/14/1/2.vector.pbf?access_token=pk.test&sku=abc";

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

  it("accepts a Request object input", async () => {
    const orig = vi.fn(async () => okResponse());
    const store = makeStore();
    const wrapped = wrapFetchWithOfflineTiles(orig, store);
    const res = await wrapped(new Request(TILE_URL));
    expect(res.status).toBe(200);
    expect(store.get).not.toHaveBeenCalled(); // network won, no fallback lookup needed
  });
});
