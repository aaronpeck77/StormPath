import { haversineMeters } from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import { safeStorage } from "../storage/safeStorage";
import type { CompletedLearnedTrip, FrequentRouteCluster } from "./types";

const STORAGE_KEY = "stormpath-frequent-route-clusters";

const MATCH_START_END_M = 320;
const MAX_CLUSTERS = 14;

function newClusterId(): string {
  return `fr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function centroidPair(geometry: LngLat[]): { start: LngLat; end: LngLat } {
  const start = geometry[0]!;
  const end = geometry[geometry.length - 1]!;
  return { start, end };
}

export function mergeTripIntoClusters(
  clusters: FrequentRouteCluster[],
  trip: CompletedLearnedTrip
): FrequentRouteCluster[] {
  const { start, end } = centroidPair(trip.geometry);
  let idx = -1;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    const forward =
      haversineMeters(start, c.centerStart) <= MATCH_START_END_M &&
      haversineMeters(end, c.centerEnd) <= MATCH_START_END_M;
    const reverse =
      haversineMeters(start, c.centerEnd) <= MATCH_START_END_M &&
      haversineMeters(end, c.centerStart) <= MATCH_START_END_M;
    if (forward || reverse) {
      idx = i;
      break;
    }
  }

  if (idx < 0) {
    const next: FrequentRouteCluster = {
      id: newClusterId(),
      count: 1,
      lastSeen: trip.endedAt,
      geometry: trip.geometry,
      centerStart: start,
      centerEnd: end,
    };
    return trimClusters([...clusters, next]);
  }

  const prev = clusters[idx]!;
  const useGeom = trip.geometry.length > prev.geometry.length ? trip.geometry : prev.geometry;
  const forward =
    haversineMeters(start, prev.centerStart) <= MATCH_START_END_M &&
    haversineMeters(end, prev.centerEnd) <= MATCH_START_END_M;
  const reverse =
    haversineMeters(start, prev.centerEnd) <= MATCH_START_END_M &&
    haversineMeters(end, prev.centerStart) <= MATCH_START_END_M;
  const next: FrequentRouteCluster = {
    ...prev,
    count: prev.count + 1,
    lastSeen: trip.endedAt,
    geometry: useGeom,
    centerStart: start,
    centerEnd: end,
    startLabel: forward ? prev.startLabel : reverse ? prev.endLabel : undefined,
    endLabel: forward ? prev.endLabel : reverse ? prev.startLabel : undefined,
  };
  const copy = [...clusters];
  copy[idx] = next;
  return trimClusters(copy);
}

function trimClusters(list: FrequentRouteCluster[]): FrequentRouteCluster[] {
  if (list.length <= MAX_CLUSTERS) return list;
  const sorted = [...list].sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count;
    return a.lastSeen - b.lastSeen;
  });
  while (sorted.length > MAX_CLUSTERS) {
    sorted.shift();
  }
  return sorted;
}

export function loadFrequentRouteClusters(): FrequentRouteCluster[] {
  const data = safeStorage.getJson<unknown>(STORAGE_KEY, []);
  if (!Array.isArray(data)) return [];
  const out: FrequentRouteCluster[] = [];
  try {
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const count = typeof o.count === "number" ? o.count : 0;
      const lastSeen = typeof o.lastSeen === "number" ? o.lastSeen : 0;
      const g = o.geometry;
      if (!id || count < 1 || !Array.isArray(g) || g.length < 2) continue;
      const geometry: LngLat[] = [];
      for (const p of g) {
        if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
          geometry.push([p[0]!, p[1]!]);
        }
      }
      if (geometry.length < 2) continue;
      const cs = o.centerStart;
      const ce = o.centerEnd;
      if (!Array.isArray(cs) || !Array.isArray(ce)) continue;
      if (!Number.isFinite(cs[0]) || !Number.isFinite(cs[1])) continue;
      if (!Number.isFinite(ce[0]) || !Number.isFinite(ce[1])) continue;
      out.push({
        id,
        count,
        lastSeen,
        geometry,
        centerStart: [cs[0]!, cs[1]!],
        centerEnd: [ce[0]!, ce[1]!],
        startLabel: typeof o.startLabel === "string" && o.startLabel.trim() ? o.startLabel.trim() : undefined,
        endLabel: typeof o.endLabel === "string" && o.endLabel.trim() ? o.endLabel.trim() : undefined,
      });
    }
    return out;
  } catch {
    return out;
  }
}

export function persistFrequentRouteClusters(clusters: FrequentRouteCluster[]): void {
  safeStorage.setJson(STORAGE_KEY, clusters);
}

export function removeFrequentRouteCluster(clusters: FrequentRouteCluster[], id: string): FrequentRouteCluster[] {
  return clusters.filter((c) => c.id !== id);
}
