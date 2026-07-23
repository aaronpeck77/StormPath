/**
 * Durable "Jeff the Fix-It Bot" activity log for ops-jeff / ops-summary.
 * Same storage strategy as `_mapboxUsageStore.ts`: Netlify @netlify/blobs in prod,
 * JSON file under OPS_USAGE_DATA_DIR for home-api / local.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type JeffFixDomain = "drive_camera" | "live_traffic";

export type JeffFixEvent = {
  atMs: number;
  domain: JeffFixDomain;
  /** True when the driver tapped Jeff to force the fix, rather than the watchdog catching it. */
  manual: boolean;
  note?: string;
};

type MonthBlob = {
  month: string;
  /** date (YYYY-MM-DD) -> events that day, oldest first. */
  days: Record<string, JeffFixEvent[]>;
};

/** Hard cap per day so a runaway client bug can't grow storage unbounded. */
const MAX_EVENTS_PER_DAY = 300;

function dataDir(): string {
  return (
    process.env.OPS_USAGE_DATA_DIR?.trim() ||
    path.resolve(process.cwd(), "home-api", "data")
  );
}

function filePath(month: string): string {
  return path.join(dataDir(), `jeff-fixes-${month}.json`);
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
    const data = await store.get(`jeff-fixes/${month}`, { type: "json" });
    if (data && typeof data === "object" && (data as MonthBlob).days) {
      return data as MonthBlob;
    }
  } catch {
    /* not on Netlify or package missing */
  }
  return null;
}

async function writeMonthBlobs(blob: MonthBlob): Promise<boolean> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("stormpath-ops");
    await store.setJSON(`jeff-fixes/${blob.month}`, blob);
    return true;
  } catch (e) {
    // TEMP diagnostic: surface the real Blobs failure instead of silently falling back to a
    // file write that can't succeed on Netlify's read-only function filesystem. Remove once
    // root-caused (see chat "Jeff fix not showing up in Control Room").
    throw new Error(`BLOBS_WRITE_FAILED: ${e instanceof Error ? e.message : String(e)}`);
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

function utcMonthPrefix(day: string): string {
  return day.slice(0, 7);
}

function sanitizeEvent(raw: unknown): JeffFixEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const atMs = Number(r.atMs);
  const domain =
    r.domain === "drive_camera" || r.domain === "live_traffic" ? r.domain : null;
  if (!Number.isFinite(atMs) || !domain) return null;
  // Reject nonsense timestamps (far future / far past) rather than trusting the client blindly.
  const now = Date.now();
  if (atMs > now + 5 * 60_000 || atMs < now - 90 * 24 * 60 * 60_000) return null;
  return {
    atMs,
    domain,
    manual: Boolean(r.manual),
    note: typeof r.note === "string" ? r.note.slice(0, 160) : undefined,
  };
}

/** Append a batch of client-reported Jeff fix events (from one device) to durable storage. */
export async function appendJeffFixEvents(
  events: unknown[]
): Promise<{ accepted: number }> {
  const clean = (Array.isArray(events) ? events : [])
    .map(sanitizeEvent)
    .filter((e): e is JeffFixEvent => e != null);
  if (!clean.length) return { accepted: 0 };

  const byMonth = new Map<string, Map<string, JeffFixEvent[]>>();
  for (const ev of clean) {
    const date = new Date(ev.atMs).toISOString().slice(0, 10);
    const month = utcMonthPrefix(date);
    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const days = byMonth.get(month)!;
    if (!days.has(date)) days.set(date, []);
    days.get(date)!.push(ev);
  }

  for (const [month, days] of byMonth) {
    const blob = await loadMonth(month);
    for (const [date, list] of days) {
      const merged = [...(blob.days[date] ?? []), ...list]
        .sort((a, b) => a.atMs - b.atMs)
        .slice(-MAX_EVENTS_PER_DAY);
      blob.days[date] = merged;
    }
    blob.month = month;
    await saveMonth(blob);
  }
  return { accepted: clean.length };
}

export type JeffFixCounts = {
  drive_camera: number;
  live_traffic: number;
  manual: number;
  total: number;
};

export type JeffFixSummary = {
  generatedAt: string;
  countsToday: JeffFixCounts;
  counts7d: JeffFixCounts;
  countsMonth: JeffFixCounts;
  /** Most recent fixes across all devices, newest first. */
  recent: JeffFixEvent[];
  note: string;
};

function emptyCounts(): JeffFixCounts {
  return { drive_camera: 0, live_traffic: 0, manual: 0, total: 0 };
}

function tally(counts: JeffFixCounts, e: JeffFixEvent): void {
  counts[e.domain] += 1;
  if (e.manual) counts.manual += 1;
  counts.total += 1;
}

/**
 * Recent fix events + today/7-day/month rollups for the Control Room. Loads the current and
 * previous month's blobs so a 7-day window still reads correctly right after a month rolls over.
 */
export async function buildJeffFixSummary(recentLimit = 40): Promise<JeffFixSummary> {
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);

  const [curBlob, prevBlob] =
    prevMonth === thisMonth
      ? [await loadMonth(thisMonth), { month: prevMonth, days: {} } as MonthBlob]
      : await Promise.all([loadMonth(thisMonth), loadMonth(prevMonth)]);

  const allEvents: JeffFixEvent[] = [
    ...Object.values(prevBlob.days).flat(),
    ...Object.values(curBlob.days).flat(),
  ].sort((a, b) => b.atMs - a.atMs);

  const todayStartMs = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
  const sevenDaysAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const monthStartMs = new Date(`${thisMonth}-01T00:00:00.000Z`).getTime();

  const countsToday = emptyCounts();
  const counts7d = emptyCounts();
  const countsMonth = emptyCounts();
  for (const e of allEvents) {
    if (e.atMs >= todayStartMs) tally(countsToday, e);
    if (e.atMs >= sevenDaysAgoMs) tally(counts7d, e);
    if (e.atMs >= monthStartMs) tally(countsMonth, e);
  }

  return {
    generatedAt: new Date().toISOString(),
    countsToday,
    counts7d,
    countsMonth,
    recent: allEvents.slice(0, recentLimit),
    note:
      "Counts every time a StormPath device's background watchdog — or a driver tapping Jeff — straightens the drive camera or kicks live traffic back awake. Devices offline when a fix happens report it once they're back online.",
  };
}
