/** Whole minutes, at least 1 — always uses hours + minutes when ≥ 60 min */
export function formatEtaDuration(totalMinutes: number): string {
  const m = Math.max(1, Math.round(totalMinutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (r === 0) return h === 1 ? "1 hr" : `${h} hr`;
  return h === 1 ? `1 hr ${r} min` : `${h} hr ${r} min`;
}

/** Traffic / baseline deltas */
export function formatDelayMinutes(delayMinutes: number): string {
  const m = Math.round(Math.max(0, delayMinutes));
  if (m < 1) return "";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (r === 0) return h === 1 ? "1 hr" : `${h} hr`;
  return h === 1 ? `1 hr ${r} min` : `${h} hr ${r} min`;
}

/** With leading + for UI, e.g. "+45 min" or "+1 hr 5 min" */
export function formatDelayVersusBaseline(delayMinutes: number): string {
  const inner = formatDelayMinutes(delayMinutes);
  return inner ? `+${inner}` : "";
}

export function etaArrivalTimestamp(minutesFromNow: number): number {
  return Date.now() + Math.max(1, Math.round(minutesFromNow)) * 60_000;
}

export function formatEtaClock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Tight duration for small toolbars: `42m`, `1h`, `1h5m`. */
export function formatEtaDurationToolbar(totalMinutes: number): string {
  const m = Math.max(1, Math.round(totalMinutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (r === 0) return h === 1 ? "1h" : `${h}h`;
  return `${h}h${r}m`;
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
