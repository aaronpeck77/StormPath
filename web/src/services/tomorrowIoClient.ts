/**
 * Tomorrow.io request pacing: 3 req/s and 25/hr on free tier — serialize calls and cache responses.
 */

const MIN_GAP_MS = 500;
const CACHE_TTL_MS = 12 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

let rateLimitedUntil = 0;
let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const responseCache = new Map<string, { at: number; data: unknown }>();

export function isTomorrowIoRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

export function noteTomorrowIoRateLimit(): void {
  rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  if (import.meta.env.DEV) {
    console.warn("[Tomorrow.io] rate limited — pausing API calls for 1 hour");
  }
}

function cacheKey(apiKey: string, body: Record<string, unknown>): string {
  return `${apiKey.slice(0, 6)}:${JSON.stringify(body)}`;
}

/** Run Tomorrow.io POSTs one at a time with spacing and short-lived cache. */
export function enqueueTomorrowIoPost(
  apiKey: string,
  body: Record<string, unknown>,
  post: (signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  if (!apiKey) return Promise.reject(new Error("Tomorrow.io API key missing"));
  if (isTomorrowIoRateLimited()) {
    return Promise.reject(new Error("Tomorrow.io rate limited"));
  }

  const key = cacheKey(apiKey, body);
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Promise.resolve(hit.data);
  }

  const run = async (): Promise<unknown> => {
    const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (isTomorrowIoRateLimited()) throw new Error("Tomorrow.io rate limited");

    lastRequestAt = Date.now();
    try {
      const data = await post(signal);
      responseCache.set(key, { at: Date.now(), data });
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429")) noteTomorrowIoRateLimit();
      throw e;
    }
  };

  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
