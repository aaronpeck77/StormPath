/**
 * Tomorrow.io request pacing: free tier ~25 req/hr, 3 req/s — serialize, cache, budget, persist 429 cooldown.
 */

import { safeStorage } from "../storage/safeStorage";

const MIN_GAP_MS = 1200;
/** Route / point forecasts stay valid long enough to avoid re-fetch on minor UI toggles. */
const CACHE_TTL_MS = 45 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;
/** Stay under Tomorrow.io's 25/hr cap (leave headroom for retries). */
const MAX_REQUESTS_PER_HOUR = 16;

const LS_RATE_UNTIL = "stormpath-tio-rate-until";
const LS_HOUR_BUDGET = "stormpath-tio-hour-budget";

let rateLimitedUntil = readPersistedRateUntil();
let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const responseCache = new Map<string, { at: number; data: unknown }>();

function readPersistedRateUntil(): number {
  if (typeof window === "undefined") return 0;
  const v = Number(safeStorage.get(LS_RATE_UNTIL));
  return Number.isFinite(v) && v > Date.now() ? v : 0;
}

function persistRateUntil(until: number): void {
  if (until > Date.now()) {
    safeStorage.set(LS_RATE_UNTIL, String(until));
  } else {
    safeStorage.remove(LS_RATE_UNTIL);
  }
}

function currentHourKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}

function readHourCount(): { hour: string; count: number } {
  if (typeof window === "undefined") return { hour: currentHourKey(), count: 0 };
  const parsed = safeStorage.getJson<{ hour?: string; count?: number } | null>(
    LS_HOUR_BUDGET,
    null
  );
  if (!parsed) return { hour: currentHourKey(), count: 0 };
  return {
    hour: typeof parsed.hour === "string" ? parsed.hour : currentHourKey(),
    count: typeof parsed.count === "number" ? parsed.count : 0,
  };
}

function writeHourCount(hour: string, count: number): void {
  safeStorage.setJson(LS_HOUR_BUDGET, { hour, count });
}

function hourBudgetRemaining(): number {
  const { hour, count } = readHourCount();
  if (hour !== currentHourKey()) return MAX_REQUESTS_PER_HOUR;
  return Math.max(0, MAX_REQUESTS_PER_HOUR - count);
}

function spendHourBudget(): void {
  const key = currentHourKey();
  const { hour, count } = readHourCount();
  writeHourCount(hour === key ? hour : key, hour === key ? count + 1 : 1);
}

export function isTomorrowIoRateLimited(): boolean {
  if (Date.now() < rateLimitedUntil) return true;
  if (hourBudgetRemaining() <= 0) return true;
  return false;
}

export function tomorrowIoBudgetRemaining(): number {
  if (Date.now() < rateLimitedUntil) return 0;
  return hourBudgetRemaining();
}

export function noteTomorrowIoRateLimit(): void {
  rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  persistRateUntil(rateLimitedUntil);
  if (import.meta.env.DEV) {
    console.warn(
      "[Tomorrow.io] rate limited — no more API calls for 1 hour (saved in this browser). Corridor forecast and minute precip pause until then."
    );
  }
}

function cacheKey(apiKey: string, body: Record<string, unknown>): string {
  return `${apiKey.slice(0, 6)}:${JSON.stringify(body)}`;
}

/** Run Tomorrow.io POSTs one at a time with spacing, cache, and hourly budget. */
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
    if (isTomorrowIoRateLimited()) throw new Error("Tomorrow.io rate limited");

    const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (isTomorrowIoRateLimited()) throw new Error("Tomorrow.io rate limited");

    lastRequestAt = Date.now();
    spendHourBudget();
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
