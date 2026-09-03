import type { LngLat } from "./types";

const STORAGE_KEY = "stormpath.navAlong.v1";
const MAX_AGE_MS = 8 * 60 * 60 * 1000;
const WRITE_MIN_INTERVAL_MS = 3_000;
const WRITE_MIN_DELTA_M = 120;

export type PersistedNavAlong = {
  alongM: number;
  geomSig: string;
  atMs: number;
};

export function navAlongGeomSig(geometry: LngLat[] | null | undefined): string {
  if (!geometry || geometry.length < 2) return "";
  const a = geometry[0]!;
  const b = geometry[geometry.length - 1]!;
  return `${geometry.length}:${a[0].toFixed(5)}:${b[0].toFixed(5)}`;
}

const memory = new Map<string, string>();

const memoryStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => {
    memory.set(k, v);
  },
  removeItem: (k) => {
    memory.delete(k);
  },
};

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    /* private mode */
  }
  return memoryStorage;
}

export function readPersistedNavAlong(geomSig: string): number | null {
  if (!geomSig) return null;
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedNavAlong;
    if (parsed.geomSig !== geomSig) return null;
    if (!Number.isFinite(parsed.alongM) || parsed.alongM < 0) return null;
    const age = Date.now() - parsed.atMs;
    if (!Number.isFinite(age) || age > MAX_AGE_MS || age < -60_000) return null;
    return parsed.alongM;
  } catch {
    return null;
  }
}

let lastWriteAtMs = 0;
let lastWriteAlongM = -1;
let lastWriteSig = "";

export function writePersistedNavAlong(geomSig: string, alongM: number): void {
  if (!geomSig || !Number.isFinite(alongM) || alongM < 0) return;
  const now = Date.now();
  if (
    geomSig === lastWriteSig &&
    now - lastWriteAtMs < WRITE_MIN_INTERVAL_MS &&
    Math.abs(alongM - lastWriteAlongM) < WRITE_MIN_DELTA_M
  ) {
    return;
  }
  const s = storage();
  if (!s) return;
  try {
    const payload: PersistedNavAlong = { alongM, geomSig, atMs: now };
    s.setItem(STORAGE_KEY, JSON.stringify(payload));
    lastWriteAtMs = now;
    lastWriteAlongM = alongM;
    lastWriteSig = geomSig;
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedNavAlong(): void {
  lastWriteAtMs = 0;
  lastWriteAlongM = -1;
  lastWriteSig = "";
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Test-only: reset write throttle between cases. */
export function resetNavAlongPersistThrottleForTests(): void {
  lastWriteAtMs = 0;
  lastWriteAlongM = -1;
  lastWriteSig = "";
}
