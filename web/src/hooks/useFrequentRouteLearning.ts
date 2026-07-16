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
import { enrichFrequentClusterLabels } from "../frequentRoutes/enrichClusterLabels";
import {
  createInitialTripState,
  forceFinishActiveTrip,
  processTripSample,
  type TripLearningMachineState,
} from "../frequentRoutes/tripDetector";
import type { CompletedLearnedTrip, FrequentRouteCluster } from "../frequentRoutes/types";
import { safeStorage } from "../storage/safeStorage";

const OPT_IN_KEY = "stormpath-frequent-routes-opt-in";
const TICK_MS = 4000;

function readOptIn(): boolean {
  const v = safeStorage.get(OPT_IN_KEY);
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return true;
}

function writeOptIn(on: boolean): void {
  safeStorage.set(OPT_IN_KEY, on ? "1" : "0");
}

/** Plus-only: loose GPS trip detection → clustered candidates for saved routes. */
export function useFrequentRouteLearning(opts: {
  payUnlocked: boolean;
  userLngLat: LngLat | null;
  speedMps: number | null;
  mapboxToken?: string;
}) {
  const [clusters, setClusters] = useState<FrequentRouteCluster[]>(() => loadFrequentRouteClusters());
  const [learnEnabled, setLearnEnabled] = useState(() => readOptIn());
  const machineRef = useRef<TripLearningMachineState | null>(null);
  const posRef = useRef<LngLat | null>(null);
  const speedRef = useRef<number | null>(null);
  const enrichInFlightRef = useRef(false);

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

  /* Resolve place names for suggestions so the list shows From → To instead of raw coords. */
  useEffect(() => {
    const token = opts.mapboxToken;
    if (!token || !opts.payUnlocked) return;
    const needs = clusters.filter(
      (c) => c.count >= 2 && (!c.startLabel?.trim() || !c.endLabel?.trim())
    );
    if (!needs.length || enrichInFlightRef.current) return;

    let cancelled = false;
    enrichInFlightRef.current = true;
    void (async () => {
      try {
        for (const c of needs.slice(0, 4)) {
          if (cancelled) break;
          const enriched = await enrichFrequentClusterLabels(c, token);
          if (cancelled || !enriched) continue;
          setClusters((prev) => {
            const next = prev.map((row) => (row.id === enriched.id ? { ...row, ...enriched } : row));
            persistFrequentRouteClusters(next);
            return next;
          });
        }
      } finally {
        enrichInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clusters, opts.mapboxToken, opts.payUnlocked]);

  const dismissCluster = useCallback((id: string) => {
    setClusters((prev) => {
      const next = removeFrequentRouteCluster(prev, id);
      persistFrequentRouteClusters(next);
      return next;
    });
  }, []);

  const recordLearnedTrip = useCallback((trip: CompletedLearnedTrip) => {
    setClusters((prev) => {
      const next = mergeTripIntoClusters(prev, trip);
      persistFrequentRouteClusters(next);
      return next;
    });
  }, []);

  const resetTripLearningMachine = useCallback(() => {
    machineRef.current = createInitialTripState(Date.now());
  }, []);

  const flushActiveLearnedTrip = useCallback((): CompletedLearnedTrip | null => {
    const p = posRef.current;
    const machine = machineRef.current;
    if (!machine) return null;
    const now = Date.now();
    const { state, trip } = forceFinishActiveTrip(machine, now, p);
    machineRef.current = state;
    if (trip) {
      recordLearnedTrip(trip);
    }
    return trip;
  }, [recordLearnedTrip]);

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
    recordLearnedTrip,
    resetTripLearningMachine,
    flushActiveLearnedTrip,
  };
}
