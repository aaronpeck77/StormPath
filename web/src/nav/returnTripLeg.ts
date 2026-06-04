import { safeStorage } from "../storage/safeStorage";
import type { LngLat } from "./types";

const STORAGE_KEY = "stormpath-return-trip-leg-v1";

export type ReturnTripLeg = {
  version: 1;
  savedAtMs: number;
  /** Where the last trip started (return destination). */
  returnToLngLat: LngLat;
  returnToLabel: string;
  /** Outbound trip destination — used when reversing the stored path. */
  outboundDestLngLat: LngLat;
  outboundDestLabel: string;
  /** Forward route geometry from the leg the driver started on Go. */
  geometry: LngLat[];
};

const GENERIC_ORIGIN = new Set(["your location", "current location"]);

export function isGenericOriginLabel(label: string): boolean {
  const t = label.trim().toLowerCase();
  return !t || GENERIC_ORIGIN.has(t);
}

function isLngLat(v: unknown): v is LngLat {
  return Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
}

export function isReturnTripLeg(v: unknown): v is ReturnTripLeg {
  if (!v || typeof v !== "object") return false;
  const o = v as ReturnTripLeg;
  if (o.version !== 1) return false;
  if (typeof o.savedAtMs !== "number" || !Number.isFinite(o.savedAtMs)) return false;
  if (!isLngLat(o.returnToLngLat) || !isLngLat(o.outboundDestLngLat)) return false;
  if (typeof o.returnToLabel !== "string" || !o.returnToLabel.trim()) return false;
  if (typeof o.outboundDestLabel !== "string" || !o.outboundDestLabel.trim()) return false;
  if (!Array.isArray(o.geometry) || o.geometry.length < 2) return false;
  return o.geometry.every(isLngLat);
}

export function loadReturnTripLeg(): ReturnTripLeg | null {
  const raw = safeStorage.getJson<unknown>(STORAGE_KEY, null);
  return isReturnTripLeg(raw) ? raw : null;
}

export function persistReturnTripLegOnGo(args: {
  returnToLngLat: LngLat;
  returnToLabel: string;
  outboundDestLngLat: LngLat;
  outboundDestLabel: string;
  geometry: LngLat[];
}): ReturnTripLeg {
  const entry: ReturnTripLeg = {
    version: 1,
    savedAtMs: Date.now(),
    returnToLngLat: [args.returnToLngLat[0], args.returnToLngLat[1]],
    returnToLabel: args.returnToLabel.trim() || "Previous stop",
    outboundDestLngLat: [args.outboundDestLngLat[0], args.outboundDestLngLat[1]],
    outboundDestLabel: args.outboundDestLabel.trim() || "Destination",
    geometry: args.geometry.map(([lng, lat]) => [lng, lat] as LngLat),
  };
  safeStorage.setJson(STORAGE_KEY, entry);
  return entry;
}

/** Short label for toolbar (keeps Rt/Dr/Mp row from overflowing). */
export function shortenReturnTripLabel(label: string, maxLen = 14): string {
  const t = label.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}
