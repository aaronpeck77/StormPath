/**
 * Trip durations — always shown as hours + minutes (e.g. `0 hr 45 min`, `1 hr 12 min`).
 */

/** Whole minutes as `0 hr 45 min` / `1 hr 0 min` (both parts always shown). */
export function formatDurationMinutes(totalMinutes: number): string {
  const total = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} hr ${m} min`;
}

/** ETA / trip length (at least 1 minute). */
export function formatEtaDuration(totalMinutes: number): string {
  return formatDurationMinutes(Math.max(1, totalMinutes));
}

/** Traffic / baseline deltas (empty when under 1 minute). */
export function formatDelayMinutes(delayMinutes: number): string {
  const m = Math.round(Math.max(0, delayMinutes));
  if (m < 1) return "";
  return formatDurationMinutes(m);
}

/** With leading + for UI, e.g. "+0 hr 45 min" */
export function formatDelayVersusBaseline(delayMinutes: number): string {
  const inner = formatDelayMinutes(delayMinutes);
  return inner ? `+${inner}` : "";
}

/** Enter/exit timing; `now` when under 1 minute. */
export function formatDurationMinutesMaybe(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min < 0) return null;
  if (min < 1) return "now";
  return formatEtaDuration(min);
}

/** @deprecated Use formatDurationMinutes — kept for existing imports. */
export const formatMinutesAsHoursMinutes = formatDurationMinutes;

export function etaArrivalTimestamp(minutesFromNow: number): number {
  return Date.now() + Math.max(1, Math.round(minutesFromNow)) * 60_000;
}

export function formatEtaClock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact toolbar: `0h 45m`, `1h 5m` (still hours + minutes). */
export function formatEtaDurationToolbar(totalMinutes: number): string {
  const total = Math.max(1, Math.round(totalMinutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

/** Compact 12h clock for tight UI: `5:14p`, `12:03a` (local). */
export function formatArrivalClockCompact(atMs: number): string {
  const d = new Date(atMs);
  let h = d.getHours();
  const min = d.getMinutes();
  const ap = h >= 12 ? "p" : "a";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min.toString().padStart(2, "0")}${ap}`;
}
