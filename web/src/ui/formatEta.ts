/**
 * Trip durations — always shown as hours + minutes (e.g. `0 hr 45 min`, `1 hr 12 min`).
 * Arrival clock labels use destination-local time when a dest is passed.
 */

import { approximateUsTimeZone } from "../forecast/solarDayNight";
import type { LngLat } from "../nav/types";

export type ArrivalClockOpts = {
  destLngLat?: LngLat | null;
  nowMs?: number;
};

export type ArrivalClockParts = {
  clock: string;
  weekday: string | null;
  zone: string | null;
};

function formatPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

function calendarDayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

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

/** Dest-local clock plus optional weekday/zone. Toolbar uses the parts on separate lines. */
export function formatArrivalClockParts(atMs: number, opts?: ArrivalClockOpts): ArrivalClockParts {
  const dest = opts?.destLngLat;
  const nowMs = opts?.nowMs ?? Date.now();
  const destTz =
    dest && dest.length >= 2 && Number.isFinite(dest[0]) && Number.isFinite(dest[1])
      ? approximateUsTimeZone(dest[1], dest[0])
      : undefined;
  const clockParts = new Intl.DateTimeFormat("en-US", {
    timeZone: destTz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(atMs));
  const hour = formatPart(clockParts, "hour") || "12";
  const minute = (formatPart(clockParts, "minute") || "00").padStart(2, "0");
  const dayPeriod = formatPart(clockParts, "dayPeriod");
  const ap = /p/i.test(dayPeriod) ? "p" : "a";
  const clock = `${hour}:${minute}${ap}`;
  if (!destTz) return { clock, weekday: null, zone: null };

  const weekday =
    calendarDayKey(atMs, destTz) !== calendarDayKey(nowMs, destTz)
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: destTz,
          weekday: "short",
        }).format(new Date(atMs))
      : null;
  const phoneTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let zone: string | null = null;
  if (destTz !== phoneTz) {
    const tzName = formatPart(
      new Intl.DateTimeFormat("en-US", {
        timeZone: destTz,
        hour: "numeric",
        timeZoneName: "short",
      }).formatToParts(new Date(atMs)),
      "timeZoneName"
    );
    if (tzName && !/GMT|UTC/i.test(tzName)) zone = tzName;
  }
  return { clock, weekday, zone };
}

/** Compact one-line clock: `5:14p`, `Fri 4:15p PDT`. */
export function formatArrivalClockCompact(atMs: number, opts?: ArrivalClockOpts): string {
  const { clock, weekday, zone } = formatArrivalClockParts(atMs, opts);
  return [weekday, clock, zone].filter(Boolean).join(" ");
}
