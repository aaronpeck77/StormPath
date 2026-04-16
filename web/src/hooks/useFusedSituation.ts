import { useMemo } from "react";
import type { TripPlan } from "../nav/types";
import {
  buildFusedSnapshot,
  type TrafficOverlay,
  type WeatherOverlay,
} from "../situation/fusedSnapshot";
import type { FusedSituationSnapshot } from "../situation/types";

/** Builds a fused snapshot from live inputs (no timer / no demo data). */
export function useFusedSituation(
  plan: TripPlan,
  weather: WeatherOverlay | undefined,
  traffic: TrafficOverlay | undefined
): FusedSituationSnapshot {
  return useMemo(
    () => buildFusedSnapshot(plan, weather, traffic),
    [plan, weather, traffic]
  );
}
