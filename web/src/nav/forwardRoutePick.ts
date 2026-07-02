import { haversineMeters, initialBearingDegrees } from "./routeGeometry";
import type { LngLat, NavRoute } from "./types";

/** Mapbox `bearings=` tolerance for drive replans — stay in front, not behind. */
export const DRIVE_FORWARD_BEARING_TOLERANCE_DEG = 32;

export function headingDeltaDegrees(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export function routeStartsWithUturn(r: NavRoute): boolean {
  const step = r.turnSteps?.[0];
  if (!step) return false;
  const mod = (step.maneuverModifier ?? "").toLowerCase();
  const type = (step.maneuverType ?? "").toLowerCase();
  const instr = step.instruction ?? "";
  return mod.includes("uturn") || type.includes("uturn") || /u-?turn/i.test(instr);
}

export function departBearingFromRoute(userLngLat: LngLat, geometry: LngLat[]): number | null {
  if (geometry.length < 2) return null;
  const to = geometry[1]!;
  if (haversineMeters(userLngLat, to) < 2) {
    if (geometry.length < 3) return null;
    return initialBearingDegrees(userLngLat, geometry[2]!);
  }
  return initialBearingDegrees(userLngLat, to);
}

/**
 * Fastest route that departs in front of the driver — not an immediate U-turn back
 * even when that would save a minute.
 */
export function pickBestForwardRoute(
  routes: NavRoute[],
  userLngLat: LngLat,
  headingDeg?: number | null
): NavRoute | null {
  if (!routes.length) return null;
  if (routes.length === 1) return routes[0]!;

  const pool = routes.filter((r) => !routeStartsWithUturn(r));
  const candidates = pool.length > 0 ? pool : routes;

  if (headingDeg == null || !Number.isFinite(headingDeg)) {
    return [...candidates].sort((a, b) => (a.baseEtaMinutes ?? 99) - (b.baseEtaMinutes ?? 99))[0]!;
  }

  const scored = candidates.map((r, index) => {
    const etaMin = r.baseEtaMinutes ?? 99;
    let score = etaMin * 2 + index * 0.05;
    if (routeStartsWithUturn(r)) score += 30;

    const depart = departBearingFromRoute(userLngLat, r.geometry);
    if (depart != null) {
      const delta = headingDeltaDegrees(headingDeg, depart);
      if (delta > 100) score += 22;
      else if (delta > 60) score += 10;
      else if (delta > 35) score += 4;
      score += delta * 0.12;
    }
    return { r, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0]!.r;
}
