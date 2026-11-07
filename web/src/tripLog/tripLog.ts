import { safeStorage } from "../storage/safeStorage";

/**
 * Device-local mileage / trip log — the "log this drive" half of StormPath Tools.
 * Entries are recorded when a guided trip ends (see useTripLifecycle.clearRoute)
 * and stay on-device; CSV export is how they leave for taxes / reimbursement.
 */

export type TripLogEntry = {
  id: string;
  startedAt: number;
  endedAt: number;
  originLabel: string;
  destinationLabel: string;
  /** Best distance estimate — GPS odometer when available, else planned route length. */
  distanceM: number;
  /** Planned route length at Go time, kept for reference. */
  plannedDistanceM?: number;
};

const STORAGE_KEY = "stormpath.tripLog.v1";
const MAX_ENTRIES = 300;

export function listTripLog(): TripLogEntry[] {
  const rows = safeStorage.getJson<TripLogEntry[]>(STORAGE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function recordTripLogEntry(
  entry: Omit<TripLogEntry, "id">
): TripLogEntry[] {
  const id = `${entry.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const next: TripLogEntry = { ...entry, id };
  const rows = [next, ...listTripLog()].slice(0, MAX_ENTRIES);
  safeStorage.setJson(STORAGE_KEY, rows);
  return rows;
}

export function clearTripLog(): void {
  safeStorage.remove(STORAGE_KEY);
}

export function tripLogTotals(entries: TripLogEntry[]): { count: number; distanceM: number } {
  let distanceM = 0;
  for (const e of entries) {
    if (Number.isFinite(e.distanceM) && e.distanceM > 0) distanceM += e.distanceM;
  }
  return { count: entries.length, distanceM };
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Spreadsheet-friendly CSV: Date, From, To, Distance, Minutes. */
export function tripLogToCsv(entries: TripLogEntry[], useMiles: boolean): string {
  const distHeader = useMiles ? "Miles" : "Km";
  const lines = [`Date,From,To,${distHeader},Minutes`];
  for (const e of entries) {
    const date = new Date(e.startedAt).toLocaleDateString();
    const miles = useMiles ? e.distanceM / 1609.344 : e.distanceM / 1000;
    const minutes = Math.max(0, Math.round((e.endedAt - e.startedAt) / 60_000));
    lines.push(
      [
        csvField(date),
        csvField(e.originLabel || ""),
        csvField(e.destinationLabel || ""),
        miles.toFixed(1),
        String(minutes),
      ].join(",")
    );
  }
  return lines.join("\n");
}
