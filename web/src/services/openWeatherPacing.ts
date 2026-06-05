/**
 * OpenWeather request pacing: free tier ~60 calls/min — serialize, cache, budget, persist 429 cooldown.
 */

import { safeStorage } from "../storage/safeStorage";
import { fetchWithTimeout, OPENWEATHER_TIMEOUT_MS } from "../utils/fetchResilient";

const MIN_GAP_MS = 600;
const CACHE_TTL_MS = 45 * 60 * 1000;
/** After 429, pause long enough that dev reloads don't immediately hammer the API again. */
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;
/** Soft hourly cap — leaves headroom under the free-tier minute burst limit. */
const MAX_REQUESTS_PER_HOUR = 24;

const LS_RATE_UNTIL = "stormpath-ow-rate-until";
const LS_HOUR_BUDGET = "stormpath-ow-hour-budget";

let rateLimitedUntil = readPersistedRateUntil();
let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

const responseCache = new Map<string, { at: number; body: string }>();

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

export function isOpenWeatherRateLimited(): boolean {
  if (Date.now() < rateLimitedUntil) return true;
  if (hourBudgetRemaining() <= 0) return true;
  return false;
}

export function noteOpenWeatherRateLimit(): void {
  rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  persistRateUntil(rateLimitedUntil);
  if (import.meta.env.DEV) {
    console.warn(
      "[OpenWeather] rate limited — no more API calls for 1 hour (saved in this browser)."
    );
  }
}

function cacheKeyForUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("appid");
  return u.toString();
}

/** Serialized GET with spacing, response cache, hourly budget, and 429 cooldown. */
export function enqueueOpenWeatherGet(url: string): Promise<Response> {
  if (isOpenWeatherRateLimited()) {
    return Promise.reject(new Error("OpenWeather rate limited"));
  }

  const key = cacheKeyForUrl(url);
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Promise.resolve(
      new Response(hit.body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  const run = async (): Promise<Response> => {
    if (isOpenWeatherRateLimited()) throw new Error("OpenWeather rate limited");

    const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (isOpenWeatherRateLimited()) throw new Error("OpenWeather rate limited");

    lastRequestAt = Date.now();
    spendHourBudget();
    const res = await fetchWithTimeout({
      input: url,
      init: { method: "GET" },
      timeoutMs: OPENWEATHER_TIMEOUT_MS,
    });
    if (res.status === 429) {
      noteOpenWeatherRateLimit();
      throw new Error("OpenWeather 429");
    }
    if (res.ok) {
      const body = await res.text();
      responseCache.set(key, { at: Date.now(), body });
      return new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    return res;
  };

  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}
