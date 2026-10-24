import { useEffect, useMemo, useState } from "react";
import { mapboxReversePlace } from "../services/mapboxGeocode";
import { pointAtAlongMeters, polylineLengthMeters } from "./routeGeometry";
import { buildRoutePlaceAnchors, type RoutePlaceAnchor } from "./routePlaceReference";
import type { LngLat, RouteTurnStep } from "./types";

const SAMPLE_STEP_M = 40_000;
const MAX_TOWN_LOOKUPS = 5;

/**
 * Exit signs from the route, plus up to five city centers along it.
 * Towns fill in after the lookup; exits are there immediately. Lookups are
 * cached, and a repeat drive through the same stretch does not ask again.
 */
export function useRoutePlaceAnchors(
  steps: RouteTurnStep[] | undefined,
  geometry: LngLat[] | undefined,
  mapboxToken: string | undefined
): RoutePlaceAnchor[] {
  const exits = useMemo(() => buildRoutePlaceAnchors(steps, geometry), [steps, geometry]);
  const [towns, setTowns] = useState<RoutePlaceAnchor[]>([]);

  const geomKey = useMemo(() => {
    if (!geometry || geometry.length < 2) return "";
    const a = geometry[0]!;
    const b = geometry[geometry.length - 1]!;
    return `${geometry.length}:${a[0].toFixed(2)},${a[1].toFixed(2)}:${b[0].toFixed(2)},${b[1].toFixed(2)}`;
  }, [geometry]);

  useEffect(() => {
    if (!mapboxToken || !geometry || geometry.length < 2) {
      setTowns([]);
      return;
    }
    const total = polylineLengthMeters(geometry);
    const samples: number[] = [];
    if (total < SAMPLE_STEP_M) {
      samples.push(total * 0.5);
    } else {
      for (let m = SAMPLE_STEP_M; m < total - 8_000 && samples.length < MAX_TOWN_LOOKUPS; m += SAMPLE_STEP_M) {
        samples.push(m);
      }
    }
    let cancelled = false;
    void (async () => {
      const out: RoutePlaceAnchor[] = [];
      for (const along of samples) {
        if (cancelled) return;
        const p = pointAtAlongMeters(geometry, along);
        const hit = await mapboxReversePlace(p[0], p[1], mapboxToken);
        if (!hit) continue;
        const key = hit.name.toLowerCase();
        if (out.some((a) => a.place?.toLowerCase() === key)) continue;
        out.push({ lngLat: hit.lngLat, place: hit.name, exitNumber: null });
      }
      if (!cancelled) setTowns(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [geomKey, geometry, mapboxToken]);

  return useMemo(() => [...exits, ...towns], [exits, towns]);
}
