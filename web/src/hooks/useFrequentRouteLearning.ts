import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "../nav/types";
import {
  ACTIVITY_MIN_SAMPLES_RANK,
  rankFrequentClustersByTrailCentroid,
  tryAppendActivitySample,
} from "../frequentRoutes/activitySamples";
import {
  loadFrequentRouteClusters,
  mergeTripIntoClusters,
  persistFrequentRouteClusters,
  removeFrequentRouteCluster,
} from "../frequentRoutes/clusters";
import {
  createInitialTripState,
  processTripSample,
  type TripLearningMachineState,
} from "../frequentRoutes/tripDetector";
import type { FrequentRouteCluster } from "../frequentRoutes/types";

const OPT_IN_KEY = "stormpath-frequent-routes-opt-in";
const TICK_MS = 4000;

function readOptIn(): boolean {
  try {
    const v = localStorage.getItem(OPT_IN_KEY);
    if (v === "0" || v === "false") return false;
    if (v === "1" || v === "true") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function writeOptIn(on: boolean): void {
  try {
    localStorage.setItem(OPT_IN_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Plus-only: loose GPS trip detection → clustered candidates for saved routes. */
export function useFrequentRouteLearning(opts: {
  payUnlocked: boolean;
  userLngLat: LngLat | null;
  speedMps: number | null;
}) {
  const [clusters, setClusters] = useState<FrequentRouteCluster[]>(() => loadFrequentRouteClusters());
  const [learnEnabled, setLearnEnabled] = useState(() => readOptIn());
  const machineRef = useRef<TripLearningMachineState | null>(null);
  const posRef = useRef<LngLat | null>(null);
  const speedRef = useRef<number | null>(null);

  useEffect(() => {
    posRef.current = opts.userLngLat;
    speedRef.current = opts.speedMps;
  }, [opts.userLngLat, opts.speedMps]);

  useEffect(() => {
    if (!machineRef.current) {
      machineRef.current = createInitialTripState(Date.now());
    }
  }, []);

  const setLearnEnabledPersist = useCallback((on: boolean) => {
    writeOptIn(on);
    setLearnEnabled(on);
    if (!on) {
      machineRef.current = createInitialTripState(Date.now());
    }
  }, []);

  useEffect(() => {
    if (!opts.payUnlocked || !learnEnabled || !opts.userLngLat) return;

    const id = window.setInterval(() => {
      const p = posRef.current;
      const sp = speedRef.current;
      if (!p || !machineRef.current) return;
      const now = Date.now();
      tryAppendActivitySample(now, p, sp);
      const { state, trip } = processTripSample(machineRef.current, now, p, sp);
      machineRef.current = state;
      if (trip) {
        setClusters((prev) => {
          const next = mergeTripIntoClusters(prev, trip);
          persistFrequentRouteClusters(next);
          return next;
        });
      }
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [opts.payUnlocked, learnEnabled, opts.userLngLat]);

  const dismissCluster = useCallback(
    (id: string) => {
      setClusters((prev) => {
        const next = removeFrequentRouteCluster(prev, id);
        persistFrequentRouteClusters(next);
        return next;
      });
    },
    []
  );

  const suggestedClusters = useMemo(() => {
    const base = clusters
      .filter((c) => c.count >= 2)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 8);
    return rankFrequentClustersByTrailCentroid(base, opts.payUnlocked && learnEnabled, ACTIVITY_MIN_SAMPLES_RANK);
  }, [clusters, learnEnabled, opts.payUnlocked]);

  return {
    suggestedClusters,
    learnEnabled,
    setLearnEnabled: setLearnEnabledPersist,
    dismissCluster,
  };
}
