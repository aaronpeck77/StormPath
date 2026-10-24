import {
  buildCumulativeDistances,
  haversineMeters,
  pointAtAlongMeters,
} from "./routeGeometry";
import type { LngLat } from "./types";

/** How often to sample a new guidance line (m). Tight enough to see a town block. */
const SAMPLE_M = 180;
/** A return only counts after the line has actually left. */
const MIN_AWAY_M = 400;
/** Town loops are local. A parallel highway miles later is not this bug. */
const MAX_AWAY_M = 4500;
/** Back at the same intersection, not merely a nearby ramp. */
const NEAR_M = 85;
/** The line has to continue past the return, the way a left would have. */
const CONTINUE_M = 160;

/**
 * True when a guidance line leaves a point, comes back to it, and keeps going.
 * That is the exit that should have been a left: right through town, back to
 * the same intersection, then down the original road.
 * No coordinates are kept — this is a yes/no for the trip dump.
 */
export function routeDoublesBack(geometry: LngLat[]): boolean {
  if (geometry.length < 4) return false;
  const cum = buildCumulativeDistances(geometry);
  const total = cum[geometry.length - 1] ?? 0;
  if (total < MIN_AWAY_M + CONTINUE_M) return false;

  const samples: LngLat[] = [];
  const alongs: number[] = [];
  for (let along = 0; along <= total; along += SAMPLE_M) {
    samples.push(pointAtAlongMeters(geometry, along, cum));
    alongs.push(along);
  }
  const lastAlong = alongs[alongs.length - 1] ?? 0;
  if (total - lastAlong > 40) {
    samples.push(geometry[geometry.length - 1]!);
    alongs.push(total);
  }

  for (let j = 0; j < samples.length; j++) {
    const alongJ = alongs[j]!;
    if (total - alongJ < CONTINUE_M) break;
    for (let i = j - 1; i >= 0; i--) {
      const away = alongJ - alongs[i]!;
      if (away < MIN_AWAY_M) continue;
      if (away > MAX_AWAY_M) break;
      if (haversineMeters(samples[i]!, samples[j]!) <= NEAR_M) return true;
    }
  }
  return false;
}
