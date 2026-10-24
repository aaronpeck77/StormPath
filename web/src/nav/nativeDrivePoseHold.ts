/**
 * Last-good Drive pose — keep in sync with DrivePoseHold.swift.
 * Rejects puck leaps when Core / GPS jumps a long way in a short time (tile flap, radio blip).
 */

export type NativeDrivePose = {
  lng: number;
  lat: number;
  alongM: number;
  headingDeg: number | null;
  speedMps: number | null;
};

export type NativeDrivePoseHoldResult = {
  pose: NativeDrivePose;
  held: boolean;
};

const MAX_LEAP_METERS = 85;
const MAX_LEAP_WINDOW_MS = 800;

function haversineMeters(a: NativeDrivePose, b: NativeDrivePose): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function createNativeDrivePoseHold(): {
  accept: (next: NativeDrivePose, nowMs?: number) => NativeDrivePoseHoldResult;
  reset: () => void;
} {
  let last: NativeDrivePose | null = null;
  let lastAt = 0;

  return {
    reset() {
      last = null;
      lastAt = 0;
    },
    accept(next: NativeDrivePose, nowMs = Date.now()): NativeDrivePoseHoldResult {
      if (!Number.isFinite(next.lng) || !Number.isFinite(next.lat)) {
        if (last) return { pose: last, held: true };
        return { pose: next, held: false };
      }
      if (!last) {
        last = next;
        lastAt = nowMs;
        return { pose: next, held: false };
      }
      const dt = nowMs - lastAt;
      const jump = haversineMeters(last, next);
      if (dt >= 0 && dt < MAX_LEAP_WINDOW_MS && jump > MAX_LEAP_METERS) {
        return { pose: last, held: true };
      }
      last = next;
      lastAt = nowMs;
      return { pose: next, held: false };
    },
  };
}
