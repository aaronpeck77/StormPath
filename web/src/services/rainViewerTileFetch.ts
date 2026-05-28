/**
 * Shared RainViewer tile fetch: in-memory cache, concurrency cap, and 429 backoff.
 * Mapbox raster tiles use the same URL templates (see rainViewerRadar host rewrite in dev).
 */

const MAX_CONCURRENT = 2;
const MIN_GAP_MS = 80;
const RATE_LIMIT_COOLDOWN_MS = 90_000;

let rateLimitedUntil = 0;
let lastRateLimitLogAt = 0;
let inFlight = 0;
let lastFetchAt = 0;
const waiters: (() => void)[] = [];

const rgbaCache = new Map<string, Uint8ClampedArray | null>();
const inFlightByUrl = new Map<string, Promise<Uint8ClampedArray | null>>();

export function isRainViewerRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

/** Milliseconds until RainViewer fetches can resume (0 when not cooling down). */
export function rainViewerRateLimitMsRemaining(): number {
  return Math.max(0, rateLimitedUntil - Date.now());
}

export function noteRainViewerRateLimit(): void {
  const now = Date.now();
  const entering = now >= rateLimitedUntil;
  rateLimitedUntil = now + RATE_LIMIT_COOLDOWN_MS;
  if (import.meta.env.DEV && entering && now - lastRateLimitLogAt > 45_000) {
    lastRateLimitLogAt = now;
    console.warn("[RainViewer] rate limited — pausing extra tile fetches for 90s");
  }
  for (const listener of rateLimitListeners) listener();
}

const rateLimitListeners = new Set<() => void>();

/** Run when RainViewer enters a cooldown (hide layers, pause animation, etc.). */
export function onRainViewerRateLimit(listener: () => void): () => void {
  rateLimitListeners.add(listener);
  return () => rateLimitListeners.delete(listener);
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

async function throttleGap(): Promise<void> {
  const wait = MIN_GAP_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

async function fetchRadarTileRgbaOnce(url: string): Promise<Uint8ClampedArray | null> {
  if (isRainViewerRateLimited()) return null;

  await acquireSlot();
  try {
    await throttleGap();
    const res = await fetch(url, { mode: "cors", cache: "force-cache" });
    if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) {
      noteRainViewerRateLimit();
      return null;
    }
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, 256, 256);
    return img.data;
  } catch {
    return null;
  } finally {
    releaseSlot();
  }
}

/** Fetch one 256×256 radar tile (cached; respects RainViewer rate limits). */
export async function fetchRadarTileRgba(url: string): Promise<Uint8ClampedArray | null> {
  if (isRainViewerRateLimited()) {
    const cached = rgbaCache.get(url);
    if (cached !== undefined) return cached;
    return null;
  }

  const cached = rgbaCache.get(url);
  if (cached !== undefined) return cached;

  let p = inFlightByUrl.get(url);
  if (!p) {
    p = fetchRadarTileRgbaOnce(url).then((data) => {
      rgbaCache.set(url, data);
      return data;
    });
    inFlightByUrl.set(url, p);
    void p.finally(() => inFlightByUrl.delete(url));
  }
  return p;
}
