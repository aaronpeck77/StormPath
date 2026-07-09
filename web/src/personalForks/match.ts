import {
  closestAlongRouteMeters,
  haversineMeters,
  initialBearingDegrees,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "../nav/routeGeometry";
import type { LngLat } from "../nav/types";
import { FORK_DEST_MATCH_M, FORK_MIN_TAKES_TO_OFFER, FORK_POINT_MATCH_M } from "./learn";
import type { PersonalFork, PersonalForkOffer } from "./types";

/** How far ahead of the driver we surface the approaching chip (meters). */
export const FORK_OFFER_AHEAD_M = 3_200;
/** Don't offer until the driver is within this distance of the fork. */
export const FORK_OFFER_MAX_AHEAD_M = 4_800;
/** Past the fork by this much → no longer "approaching". */
export const FORK_OFFER_PAST_M = 180;
/** On-fork corridor for auto-commit / suppress-rejoin. */
export const FORK_ON_CORRIDOR_M = 140;
/** Minimum meters along the fork before we treat the driver as committed. */
export const FORK_ON_MIN_ALONG_M = 80;

export type MatchPersonalForkInput = {
  forks: PersonalFork[];
  mainGeometry: LngLat[];
  userLngLat: LngLat;
  userAlongMainM: number;
  destLngLat: LngLat | null;
  /** When true, include forks with takeCount === 1 (debug / early learning). */
  includeWeak?: boolean;
};

/**
 * Find the best habitual fork for the current main route + destination.
 * Prefers forks the driver is approaching or already on.
 */
export function matchPersonalForkOffer(input: MatchPersonalForkInput): PersonalForkOffer | null {
  const { forks, mainGeometry, userLngLat, userAlongMainM, destLngLat, includeWeak } = input;
  if (mainGeometry.length < 2 || forks.length === 0) return null;

  const mainLen = polylineLengthMeters(mainGeometry);
  if (mainLen < 500) return null;

  const minTakes = includeWeak ? 1 : FORK_MIN_TAKES_TO_OFFER;
  let best: PersonalForkOffer | null = null;

  for (const fork of forks) {
    if (fork.dismissed || fork.takeCount < minTakes || fork.geometry.length < 2) continue;
    if (destLngLat && haversineMeters(fork.destCenter, destLngLat) > FORK_DEST_MATCH_M * 1.8) {
      continue;
    }

    const { alongMeters: alongToForkM, lateralMetersApprox: forkToMainLat } =
      closestAlongRouteMeters(fork.forkPoint, mainGeometry);
    if (forkToMainLat > FORK_POINT_MATCH_M) continue;

    const onFork = isOnPersonalForkCorridor(userLngLat, fork.geometry);
    const metersToFork = alongToForkM - userAlongMainM;

    /* Already on the familiar detour — keep offering even after the main-route exit is behind. */
    if (!onFork) {
      if (alongToForkM < userAlongMainM - FORK_OFFER_PAST_M) continue;
      if (metersToFork > FORK_OFFER_MAX_AHEAD_M) continue;
    }

    const approaching =
      !onFork && metersToFork >= -FORK_OFFER_PAST_M && metersToFork <= FORK_OFFER_AHEAD_M;

    if (!onFork && !approaching) continue;

    const offer: PersonalForkOffer = {
      fork,
      alongToForkM,
      metersToFork: Math.max(0, metersToFork),
      phase: onFork ? "on_fork" : "approaching",
    };

    if (!best) {
      best = offer;
      continue;
    }
    /* Prefer on_fork, then nearer fork, then higher take count. */
    if (offer.phase === "on_fork" && best.phase !== "on_fork") {
      best = offer;
    } else if (offer.phase === best.phase) {
      if (offer.metersToFork < best.metersToFork - 40) best = offer;
      else if (
        Math.abs(offer.metersToFork - best.metersToFork) <= 40 &&
        offer.fork.takeCount > best.fork.takeCount
      ) {
        best = offer;
      }
    }
  }

  return best;
}

export function isOnPersonalForkCorridor(
  user: LngLat,
  forkGeometry: LngLat[],
  corridorM = FORK_ON_CORRIDOR_M
): boolean {
  if (forkGeometry.length < 2) return false;
  const { alongMeters, lateralMetersApprox } = closestAlongRouteMeters(user, forkGeometry);
  if (lateralMetersApprox > corridorM) return false;
  return alongMeters >= FORK_ON_MIN_ALONG_M;
}

/**
 * True when the driver has left the main corridor toward a known fork
 * (exit taken) — used to auto-commit without waiting for a tap.
 */
export function shouldAutoCommitPersonalFork(opts: {
  offer: PersonalForkOffer;
  userLngLat: LngLat;
  mainGeometry: LngLat[];
  userAlongMainM: number;
  headingDeg: number | null;
}): boolean {
  const { offer, userLngLat, mainGeometry, userAlongMainM, headingDeg } = opts;
  if (offer.phase === "on_fork") return true;

  const { lateralMetersApprox } = closestAlongRouteMeters(userLngLat, mainGeometry);
  if (lateralMetersApprox < 45) return false;
  if (userAlongMainM < offer.alongToForkM - 350) return false;
  if (userAlongMainM > offer.alongToForkM + 900) return false;

  if (headingDeg != null && Number.isFinite(headingDeg)) {
    const look = pointAtAlongMeters(offer.fork.geometry, Math.min(200, polylineLengthMeters(offer.fork.geometry) * 0.15));
    const forkBear = initialBearingDegrees(offer.fork.forkPoint, look);
    let d = Math.abs(headingDeg - forkBear) % 360;
    if (d > 180) d = 360 - d;
    if (d > 70) return false;
  }

  return isOnPersonalForkCorridor(userLngLat, offer.fork.geometry, FORK_ON_CORRIDOR_M + 40);
}

export function formatForkEtaDelta(deltaMin: number | null): string | null {
  if (deltaMin == null || !Number.isFinite(deltaMin)) return null;
  const rounded = Math.round(deltaMin);
  if (rounded === 0) return "similar ETA";
  if (rounded > 0) return `~${rounded} min longer`;
  return `~${Math.abs(rounded)} min shorter`;
}
