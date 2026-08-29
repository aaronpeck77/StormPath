import { safeStorage } from "../storage/safeStorage";
import type { LngLat } from "../nav/types";
import {
  createInitialTripState,
  type TripLearningMachineState,
} from "./tripDetector";

const LS_KEY = "stormpath-trip-learning-machine-v1";
/** Drop a stale in-progress trip after this long without a tick (app killed mid-commute). */
const MAX_STALE_MS = 3 * 60 * 60_000;

type Persisted = {
  phase: "active";
  points: LngLat[];
  startedAt: number;
  lastAppendAt: number;
  lastAppended: LngLat | null;
  slowSince: number | null;
  savedAt: number;
};

function isLngLat(v: unknown): v is LngLat {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/** Persist an in-progress learned trip so a brief lock-screen / suspend does not wipe it. */
export function saveTripLearningMachine(state: TripLearningMachineState, now = Date.now()): void {
  if (state.phase !== "active" || state.points.length < 1) {
    safeStorage.remove(LS_KEY);
    return;
  }
  const payload: Persisted = {
    phase: "active",
    points: state.points,
    startedAt: state.startedAt,
    lastAppendAt: state.lastAppendAt,
    lastAppended: state.lastAppended,
    slowSince: state.slowSince,
    savedAt: now,
  };
  safeStorage.set(LS_KEY, JSON.stringify(payload));
}

export function clearTripLearningMachinePersist(): void {
  safeStorage.remove(LS_KEY);
}

/** Restore an active trip, or a fresh idle machine if nothing valid is stored. */
export function loadTripLearningMachine(now = Date.now()): TripLearningMachineState {
  const raw = safeStorage.get(LS_KEY);
  if (!raw) return createInitialTripState(now);
  try {
    const p = JSON.parse(raw) as Partial<Persisted>;
    if (p.phase !== "active" || !Array.isArray(p.points) || p.points.length < 1) {
      clearTripLearningMachinePersist();
      return createInitialTripState(now);
    }
    const savedAt = typeof p.savedAt === "number" ? p.savedAt : 0;
    if (!savedAt || now - savedAt > MAX_STALE_MS) {
      clearTripLearningMachinePersist();
      return createInitialTripState(now);
    }
    const points = p.points.filter(isLngLat);
    if (points.length < 1) {
      clearTripLearningMachinePersist();
      return createInitialTripState(now);
    }
    return {
      phase: "active",
      points,
      startedAt: typeof p.startedAt === "number" ? p.startedAt : now,
      lastAppendAt: typeof p.lastAppendAt === "number" ? p.lastAppendAt : now,
      lastAppended: isLngLat(p.lastAppended) ? p.lastAppended : points[points.length - 1]!,
      slowSince: typeof p.slowSince === "number" ? p.slowSince : null,
    };
  } catch {
    clearTripLearningMachinePersist();
    return createInitialTripState(now);
  }
}
