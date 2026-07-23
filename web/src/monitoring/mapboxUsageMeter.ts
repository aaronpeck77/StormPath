/**
 * Client-side Mapbox usage meter.
 *
 * Mapbox has no public Statistics API — StormPath counts its own Directions /
 * Geocoding / Matching / Search Box / Nav-trip / map-load calls, persists pending
 * deltas, and periodically POSTs them to `ops-usage` so the Control Room can show
 * month-to-date vs free-tier limits.
 */

import { safeStorage } from "../storage/safeStorage";
import { getWebEnv } from "../config/env";
import {
  addMapboxUsageCounters,
  emptyMapboxUsageCounters,
  utcToday,
  type MapboxUsageCounters,
} from "./mapboxUsageLimits";

export type MapboxUsageKind = keyof MapboxUsageCounters;

const PENDING_KEY = "stormpath.mapboxUsage.pending.v1";
const LOCAL_DAYS_KEY = "stormpath.mapboxUsage.localDays.v1";
const DEVICE_KEY = "stormpath.mapboxUsage.deviceId.v1";
const FLUSH_MS = 45_000;

type PendingBlob = {
  date: string;
  counters: MapboxUsageCounters;
};

type LocalDaysBlob = Record<string, MapboxUsageCounters>;

let pending: PendingBlob | null = null;
let flushTimer: number | null = null;
let flushInFlight = false;
let started = false;

function deviceId(): string {
  let id = safeStorage.get(DEVICE_KEY);
  if (id && id.length >= 8) return id;
  id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  safeStorage.set(DEVICE_KEY, id);
  return id;
}

function loadPending(): PendingBlob {
  const today = utcToday();
  const raw = safeStorage.getJson<PendingBlob | null>(PENDING_KEY, null);
  if (raw && raw.date === today && raw.counters) {
    return {
      date: today,
      counters: addMapboxUsageCounters(emptyMapboxUsageCounters(), raw.counters),
    };
  }
  return { date: today, counters: emptyMapboxUsageCounters() };
}

function savePending(blob: PendingBlob): void {
  safeStorage.setJson(PENDING_KEY, blob);
}

function addLocalDay(date: string, deltas: Partial<MapboxUsageCounters>): void {
  const all = safeStorage.getJson<LocalDaysBlob>(LOCAL_DAYS_KEY, {});
  const prev = all[date] ?? emptyMapboxUsageCounters();
  all[date] = addMapboxUsageCounters(prev, deltas);
  const keys = Object.keys(all).sort();
  while (keys.length > 90) {
    const drop = keys.shift();
    if (drop) delete all[drop];
  }
  safeStorage.setJson(LOCAL_DAYS_KEY, all);
}

/** Month-to-date totals counted on this device only (offline / local Control Room). */
export function readLocalMapboxUsageMonth(monthPrefix = utcToday().slice(0, 7)): MapboxUsageCounters {
  const all = safeStorage.getJson<LocalDaysBlob>(LOCAL_DAYS_KEY, {});
  let sum = emptyMapboxUsageCounters();
  for (const [date, c] of Object.entries(all)) {
    if (date.startsWith(monthPrefix)) sum = addMapboxUsageCounters(sum, c);
  }
  return sum;
}

function scheduleFlush(): void {
  if (typeof window === "undefined") return;
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushMapboxUsage();
  }, FLUSH_MS);
}

/**
 * Record a successful Mapbox billable unit. Cached / failed calls should not call this.
 */
export function recordMapboxUsage(kind: MapboxUsageKind, n = 1): void {
  if (!Number.isFinite(n) || n <= 0) return;
  const today = utcToday();
  if (!pending || pending.date !== today) pending = loadPending();
  const add = Math.floor(n);
  pending.counters[kind] = (pending.counters[kind] || 0) + add;
  savePending(pending);
  addLocalDay(today, { [kind]: add });
  scheduleFlush();
}

function opsUsageEndpoints(): string[] {
  const env = getWebEnv();
  const custom = (import.meta.env.VITE_OPS_USAGE_URL as string | undefined)?.trim();
  const out: string[] = [];
  if (custom) out.push(custom.replace(/\/$/, ""));
  if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
    out.push(`${window.location.origin}/ops-usage`);
    out.push(`${window.location.origin}/.netlify/functions/ops-usage`);
  }
  const wk = env.weatherKitTokenUrl || "";
  try {
    const u = new URL(wk);
    out.push(`${u.origin}/.netlify/functions/ops-usage`);
    out.push(`${u.origin}/ops-usage`);
  } catch {
    /* ignore */
  }
  return [...new Set(out)];
}

function ingestToken(): string {
  return (import.meta.env.VITE_OPS_USAGE_INGEST_TOKEN as string | undefined)?.trim() || "";
}

/** Push pending deltas to ops-usage (no-op when nothing pending). */
export async function flushMapboxUsage(): Promise<void> {
  if (flushInFlight) return;
  if (!pending) pending = loadPending();
  const snapshot = {
    date: pending.date,
    counters: { ...pending.counters },
  };
  const has =
    snapshot.counters.directions ||
    snapshot.counters.geocoding ||
    snapshot.counters.matching ||
    snapshot.counters.navTrips ||
    snapshot.counters.searchBox ||
    snapshot.counters.mapLoads;
  if (!has) return;

  const token = ingestToken();
  if (!token) return;

  flushInFlight = true;
  try {
    const body = JSON.stringify({
      date: snapshot.date,
      deltas: snapshot.counters,
      deviceId: deviceId(),
    });
    let ok = false;
    for (const url of opsUsageEndpoints()) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body,
          cache: "no-store",
        });
        if (res.ok) {
          ok = true;
          break;
        }
        if (res.status !== 404) break;
      } catch {
        /* try next */
      }
    }
    if (ok) {
      pending = { date: utcToday(), counters: emptyMapboxUsageCounters() };
      savePending(pending);
    } else if (import.meta.env.DEV) {
      console.info("[mapbox-usage] ingest unavailable — will retry; local month totals still updated");
    }
  } finally {
    flushInFlight = false;
  }
}

/** Call once from app boot so pending counts flush on a timer + when backgrounding. */
export function startMapboxUsageMeter(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  pending = loadPending();
  scheduleFlush();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushMapboxUsage();
  });
  window.addEventListener("pagehide", () => {
    void flushMapboxUsage();
  });
}
