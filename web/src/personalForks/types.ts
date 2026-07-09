import type { LngLat } from "../nav/types";

/**
 * A habitual off-main detour learned from repeated drives (e.g. same exit → country roads home).
 * Device-local only — mirrors frequent-route learning privacy.
 */
export type PersonalFork = {
  id: string;
  /** Where the driver usually leaves the main corridor. */
  forkPoint: LngLat;
  /** Typical heading just after leaving the main corridor (0–360). */
  forkBearingDeg: number;
  /** Geometry of the familiar detour from near the fork to the destination. */
  geometry: LngLat[];
  /** Destination centroid used for matching future trips. */
  destCenter: LngLat;
  /** Optional origin centroid (start of the parent trip). */
  originCenter: LngLat | null;
  takeCount: number;
  lastTakenMs: number;
  createdAtMs: number;
  /** Rough ETA delta vs main when last measured (minutes; positive = slower). */
  typicalEtaDeltaMin: number | null;
  /** User dismissed suggestions for this fork. */
  dismissed?: boolean;
};

export type PersonalForkOffer = {
  fork: PersonalFork;
  /** Meters along the active main route to the fork point. */
  alongToForkM: number;
  /** Remaining meters to the fork from the driver's along-route position. */
  metersToFork: number;
  phase: "approaching" | "on_fork";
};
