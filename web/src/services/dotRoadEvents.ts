/**
 * State DOT / WZDx road events — fetched from the stormpath-dot-feeds
 * Cloudflare Worker (cloudflare/dot-feeds). One normalized endpoint replaces
 * ~35 per-state feeds. Plus-gated by the caller.
 */
import { getWebEnv } from "../config/env";

export type DotEventKind = "construction" | "closure" | "incident" | "other";

export type DotRoadEvent = {
  id: string;
  state: string;
  publisher: string;
  kind: DotEventKind;
  status: "active" | "scheduled";
  title: string;
  roadName: string;
  direction: string | null;
  description: string;
  restrictionsText: string | null;
  lanesClosed: number;
  vehicleImpact: string | null;
  startIso: string | null;
  endIso: string | null;
  /** Representative centroid [lng, lat]. */
  point: [number, number];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  geometry: GeoJSON.Geometry | null;
};

export type DotEventsResponse = {
  fetchedAt: number;
  count: number;
  events: DotRoadEvent[];
};

function baseUrl(): string {
  return (getWebEnv().dotFeedUrl ?? "").replace(/\/+$/, "");
}

/** Corridor bbox: west,south,east,north with a margin so roadside work is caught. */
export async function fetchDotEventsForBbox(
  bbox: [number, number, number, number],
  signal?: AbortSignal
): Promise<DotEventsResponse | null> {
  const base = baseUrl();
  if (!base) return null;
  const q = `${bbox[0].toFixed(4)},${bbox[1].toFixed(4)},${bbox[2].toFixed(4)},${bbox[3].toFixed(4)}`;
  const res = await fetch(`${base}/events?bbox=${q}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as DotEventsResponse;
  return Array.isArray(data?.events) ? data : null;
}
