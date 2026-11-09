/**
 * Fetches the corridor slice of the state-DOT/WZDx feed for the active route.
 * Enabled only for Plus; refreshes on route change and every 10 min while on.
 */
import { useEffect, useMemo, useState } from "react";
import {
  fetchDotEventsForBbox,
  type DotEventsResponse,
  type DotRoadEvent,
} from "../services/dotRoadEvents";
import type { LngLat } from "./types";

const REFRESH_MS = 10 * 60_000;
/** ~13 km margin around the route bbox so work just off the line still lands. */
const BBOX_MARGIN_DEG = 0.12;
const FETCH_DEBOUNCE_MS = 900;

export function routeCorridorBbox(geometry: LngLat[]): [number, number, number, number] | null {
  if (!geometry.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of geometry) {
    if (lng < w) w = lng;
    if (lat < s) s = lat;
    if (lng > e) e = lng;
    if (lat > n) n = lat;
  }
  return [
    Math.max(-180, w - BBOX_MARGIN_DEG),
    Math.max(-90, s - BBOX_MARGIN_DEG),
    Math.min(180, e + BBOX_MARGIN_DEG),
    Math.min(90, n + BBOX_MARGIN_DEG),
  ];
}

export function useDotRoadEvents(opts: {
  enabled: boolean;
  geometry: LngLat[] | undefined;
}): DotEventsResponse | null {
  const { enabled, geometry } = opts;
  const bbox = useMemo(
    () => (geometry?.length ? routeCorridorBbox(geometry) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, geometry ? geometry.length : 0, geometry?.[0]?.[0], geometry?.[geometry.length - 1]?.[0]]
  );
  const [data, setData] = useState<DotEventsResponse | null>(null);

  useEffect(() => {
    if (!enabled || !bbox) {
      setData(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const res = await fetchDotEventsForBbox(bbox);
        if (!cancelled && res) setData(res);
      } catch {
        /* keep last good snapshot */
      }
    };

    timer = setTimeout(() => void load(), FETCH_DEBOUNCE_MS);
    const interval = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bbox?.join(",")]);

  return data;
}

export type { DotRoadEvent };
