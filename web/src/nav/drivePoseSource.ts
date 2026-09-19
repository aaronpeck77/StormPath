/**
 * One pose pipeline while Core is driving.
 *
 * Core already map-matches at ~1 Hz and applies its own pose hold, and the banner
 * and along-route progress read from it. The puck, though, was fed raw Capacitor
 * GPS and then snapped to the polyline a second time in JS — two opinions about
 * where the car is, which only disagree when it matters (weak cell, parallel
 * frontage road, tunnel). Extra CPU on the 60 fps loop for a worse answer.
 *
 * While Core is fresh, the puck interpolates Core's enhanced location and the DIY
 * snap is skipped. If Core stops reporting, fall back to GPS *and* the DIY snap —
 * web-only Go and a dead plugin both land there.
 */

export type DrivePoseSource = "core" | "gps";

/**
 * Core reports ~1/s. Give it three beats before handing the puck back to raw GPS,
 * so one dropped sample does not switch pipelines mid-corner.
 */
export const CORE_POSE_STALE_MS = 3_200;

export function pickDrivePoseSource(input: {
  /** `NATIVE_DRIVE_FOLLOW_CAM_ENABLED` and a live native session. */
  coreFollowActive: boolean;
  corePose: { lng: number; lat: number } | null | undefined;
  /** When the last Core progress event arrived (ms, same clock as `nowMs`). */
  coreSampleAtMs: number | null;
  nowMs: number;
  staleMs?: number;
}): DrivePoseSource {
  if (!input.coreFollowActive) return "gps";
  const pose = input.corePose;
  if (!pose || !Number.isFinite(pose.lng) || !Number.isFinite(pose.lat)) return "gps";
  const at = input.coreSampleAtMs;
  if (at == null || !Number.isFinite(at)) return "gps";
  const staleMs = input.staleMs ?? CORE_POSE_STALE_MS;
  if (input.nowMs - at > staleMs) return "gps";
  return "core";
}

/**
 * The DIY polyline snap is a stand-in for map matching. Running it on top of a
 * Core pose re-snaps an already-snapped point — and on a divided highway it can
 * pull the puck to the wrong carriageway.
 */
export function shouldSnapPuckToRoute(source: DrivePoseSource): boolean {
  return source === "gps";
}

/**
 * A Core pose is already on the road, so the puck should use the snapped (tighter)
 * blend constant even though the JS snap never ran.
 */
export function drivePoseCountsAsSnapped(input: {
  source: DrivePoseSource;
  diySnapLatched: boolean;
}): boolean {
  return input.source === "core" || input.diySnapLatched;
}
