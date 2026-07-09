import type { LngLat } from "../nav/types";
import { safeStorage } from "../storage/safeStorage";
import type { PersonalFork } from "./types";

const STORAGE_KEY = "stormpath-personal-forks-v1";
const MAX_FORKS = 24;

function parseLngLat(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const lng = v[0];
  const lat = v[1];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function parseGeometry(v: unknown): LngLat[] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const out: LngLat[] = [];
  for (const p of v) {
    const ll = parseLngLat(p);
    if (ll) out.push(ll);
  }
  return out.length >= 2 ? out : null;
}

export function loadPersonalForks(): PersonalFork[] {
  const data = safeStorage.getJson<unknown>(STORAGE_KEY, []);
  if (!Array.isArray(data)) return [];
  const out: PersonalFork[] = [];
  try {
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const forkPoint = parseLngLat(o.forkPoint);
      const geometry = parseGeometry(o.geometry);
      const destCenter = parseLngLat(o.destCenter);
      if (!id || !forkPoint || !geometry || !destCenter) continue;
      const forkBearingDeg =
        typeof o.forkBearingDeg === "number" && Number.isFinite(o.forkBearingDeg)
          ? ((o.forkBearingDeg % 360) + 360) % 360
          : 0;
      const takeCount = typeof o.takeCount === "number" && o.takeCount >= 1 ? Math.floor(o.takeCount) : 1;
      const lastTakenMs = typeof o.lastTakenMs === "number" ? o.lastTakenMs : 0;
      const createdAtMs = typeof o.createdAtMs === "number" ? o.createdAtMs : lastTakenMs;
      const typicalEtaDeltaMin =
        typeof o.typicalEtaDeltaMin === "number" && Number.isFinite(o.typicalEtaDeltaMin)
          ? o.typicalEtaDeltaMin
          : null;
      const originCenter = o.originCenter == null ? null : parseLngLat(o.originCenter);
      out.push({
        id,
        forkPoint,
        forkBearingDeg,
        geometry,
        destCenter,
        originCenter,
        takeCount,
        lastTakenMs,
        createdAtMs,
        typicalEtaDeltaMin,
        dismissed: o.dismissed === true,
      });
    }
    return out;
  } catch {
    return out;
  }
}

export function persistPersonalForks(forks: PersonalFork[]): void {
  safeStorage.setJson(STORAGE_KEY, forks.slice(0, MAX_FORKS));
}

export function trimPersonalForks(forks: PersonalFork[]): PersonalFork[] {
  if (forks.length <= MAX_FORKS) return forks;
  const sorted = [...forks].sort((a, b) => {
    if (a.takeCount !== b.takeCount) return a.takeCount - b.takeCount;
    return a.lastTakenMs - b.lastTakenMs;
  });
  while (sorted.length > MAX_FORKS) sorted.shift();
  return sorted;
}

export function removePersonalFork(forks: PersonalFork[], id: string): PersonalFork[] {
  return forks.filter((f) => f.id !== id);
}

export function dismissPersonalFork(forks: PersonalFork[], id: string): PersonalFork[] {
  return forks.map((f) => (f.id === id ? { ...f, dismissed: true } : f));
}
