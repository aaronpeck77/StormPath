import type { LngLat } from "../nav/types";

/** One finished trip segment inferred from GPS (device-local only). */
export type CompletedLearnedTrip = {
  geometry: LngLat[];
  startedAt: number;
  endedAt: number;
  distanceM: number;
};

/** Clustered trips with similar start/end — offered as “save to favorites” candidates. */
export type FrequentRouteCluster = {
  id: string;
  count: number;
  lastSeen: number;
  geometry: LngLat[];
  centerStart: LngLat;
  centerEnd: LngLat;
  /** Start times (ms) of merged trips, newest last — powers the plan-time "usual time" trigger. */
  recentStarts?: number[];
  /** Reverse-geocoded place near start (cached on device). */
  startLabel?: string;
  /** Reverse-geocoded place near end (cached on device). */
  endLabel?: string;
};
