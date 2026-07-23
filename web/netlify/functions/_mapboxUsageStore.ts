/**
 * Durable Mapbox usage day store for ops-usage / ops-summary.
 * Netlify: @netlify/blobs. Home-api / local: JSON file under OPS_USAGE_DATA_DIR.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addMapboxUsageCounters,
  clampUsageDeltas,
  emptyMapboxUsageCounters,
  sumUsageDays,
  utcMonthPrefix,
  utcToday,
  usagePct,
  usageWarnLevel,
  MAPBOX_FREE_TIER,
  MAPBOX_USAGE_LABELS,
  type MapboxUsageCounters,
  type MapboxUsageDay,
  type UsageWarnLevel,
} from "../../src/monitoring/mapboxUsageLimits.ts";

type MonthBlob = {
  month: string;
  days: Record<string, MapboxUsageDay>;
};

function dataDir(): string {
  return (
    process.env.OPS_USAGE_DATA_DIR?.trim() ||
    path.resolve(process.cwd(), "home-api", "data")
  );
}

function filePath(month: string): string {
  return path.join(dataDir(), `mapbox-usage-${month}.json`);
}

async function readMonthFile(month: string): Promise<MonthBlob> {
  try {
    const raw = await readFile(filePath(month), "utf8");
    const parsed = JSON.parse(raw) as MonthBlob;
    if (parsed && typeof parsed === "object" && parsed.days) return parsed;
  } catch {
    /* missing / corrupt */
  }
  return { month, days: {} };
}

async function writeMonthFile(blob: MonthBlob): Promise<void> {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  await writeFile(filePath(blob.month), JSON.stringify(blob, null, 2), "utf8");
}

async function readMonthBlobs(month: string): Promise<MonthBlob | null> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("stormpath-ops");
    const data = await store.get(`mapbox-usage/${month}`, { type: "json" });
    if (data && typeof data === "object" && (data as MonthBlob).days) {
      return data as MonthBlob;
    }
  } catch (e) {
    // Falls back to the (non-durable-on-Netlify) file store below. Logged so a regression here
    // is visible in Netlify's function logs instead of silently losing data again — this exact
    // path was broken for weeks because Blobs needs `connectLambda(event)` in Lambda-compat mode.
    console.error("[mapbox-usage] Blobs read failed, falling back:", e);
  }
  return null;
}

async function writeMonthBlobs(blob: MonthBlob): Promise<boolean> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("stormpath-ops");
    await store.setJSON(`mapbox-usage/${blob.month}`, blob);
    return true;
  } catch (e) {
    console.error("[mapbox-usage] Blobs write failed, falling back:", e);
    return false;
  }
}

async function loadMonth(month: string): Promise<MonthBlob> {
  const fromBlobs = await readMonthBlobs(month);
  if (fromBlobs) return fromBlobs;
  return readMonthFile(month);
}

async function saveMonth(blob: MonthBlob): Promise<void> {
  const wroteBlobs = await writeMonthBlobs(blob);
  if (!wroteBlobs) await writeMonthFile(blob);
}

export async function mergeMapboxUsageDay(
  date: string,
  deltas: Partial<MapboxUsageCounters>
): Promise<MapboxUsageDay> {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : utcToday();
  const month = utcMonthPrefix(day);
  const clamped = clampUsageDeltas(deltas);
  const blob = await loadMonth(month);
  const prev = blob.days[day] ?? {
    date: day,
    updatedAt: new Date().toISOString(),
    ...emptyMapboxUsageCounters(),
  };
  const next: MapboxUsageDay = {
    date: day,
    updatedAt: new Date().toISOString(),
    ...addMapboxUsageCounters(prev, clamped),
  };
  blob.days[day] = next;
  blob.month = month;
  await saveMonth(blob);
  return next;
}

export type MapboxUsageSummary = {
  source: "app_meter";
  month: string;
  totals: MapboxUsageCounters;
  freeTier: MapboxUsageCounters;
  levels: Record<keyof MapboxUsageCounters, UsageWarnLevel>;
  pct: Record<keyof MapboxUsageCounters, number>;
  labels: typeof MAPBOX_USAGE_LABELS;
  dayCount: number;
  note: string;
};

export async function buildMapboxUsageSummary(
  month = utcMonthPrefix()
): Promise<MapboxUsageSummary> {
  const blob = await loadMonth(month);
  const days = Object.values(blob.days);
  const totals = sumUsageDays(days);
  const levels = {} as Record<keyof MapboxUsageCounters, UsageWarnLevel>;
  const pct = {} as Record<keyof MapboxUsageCounters, number>;
  for (const key of Object.keys(MAPBOX_FREE_TIER) as (keyof MapboxUsageCounters)[]) {
    const p = usagePct(totals[key], MAPBOX_FREE_TIER[key]);
    pct[key] = p;
    levels[key] = usageWarnLevel(p);
  }
  return {
    source: "app_meter",
    month,
    totals,
    freeTier: { ...MAPBOX_FREE_TIER },
    levels,
    pct,
    labels: MAPBOX_USAGE_LABELS,
    dayCount: days.length,
    note:
      "Counted by StormPath when the app successfully calls Mapbox. Map loads/tiles are not included — check account.mapbox.com → Statistics for those. Figures can lag or under-count if devices cannot reach ops-usage.",
  };
}
