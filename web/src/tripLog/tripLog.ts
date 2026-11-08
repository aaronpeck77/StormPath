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
  /** Via-stop labels captured at Go — the intermediate points of a multi-stop run. */
  stops?: string[];
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

/** "Origin → Stop 1 → Stop 2 → Destination" — the full chain for display. */
export function tripLogRouteChain(e: TripLogEntry): string {
  const origin = e.originLabel?.trim();
  const parts = [
    ...(origin && origin !== "Trip start" ? [origin] : []),
    ...(e.stops ?? []).map((s) => s.trim()).filter(Boolean),
    e.destinationLabel?.trim() || "Destination",
  ];
  return parts.join(" → ");
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Spreadsheet-friendly CSV: Date, From, To, Stops, Distance, Minutes + totals row. */
export function tripLogToCsv(entries: TripLogEntry[], useMiles: boolean): string {
  const distHeader = useMiles ? "Miles" : "Km";
  const lines = [`Date,From,To,Stops,${distHeader},Minutes`];
  let totalDistanceM = 0;
  let totalMinutes = 0;
  for (const e of entries) {
    const date = new Date(e.startedAt).toLocaleDateString();
    const miles = useMiles ? e.distanceM / 1609.344 : e.distanceM / 1000;
    const minutes = Math.max(0, Math.round((e.endedAt - e.startedAt) / 60_000));
    if (Number.isFinite(e.distanceM) && e.distanceM > 0) totalDistanceM += e.distanceM;
    totalMinutes += minutes;
    lines.push(
      [
        csvField(date),
        csvField(e.originLabel || ""),
        csvField(e.destinationLabel || ""),
        csvField((e.stops ?? []).join(" → ")),
        miles.toFixed(1),
        String(minutes),
      ].join(",")
    );
  }
  const totalDist = useMiles ? totalDistanceM / 1609.344 : totalDistanceM / 1000;
  lines.push(["Total", "", "", "", totalDist.toFixed(1), String(totalMinutes)].join(","));
  return lines.join("\n");
}
