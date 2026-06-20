import type { Props } from "./DriveMap";

export function driveMapPropsAreEqual(prev: Props, next: Props): boolean {
  if (
    prev.navigationStarted &&
    next.navigationStarted &&
    prev.viewMode === "drive" &&
    next.viewMode === "drive"
  ) {
    const posQ = 0.00012;
    if (prev.userLngLat && next.userLngLat) {
      if (
        Math.abs(prev.userLngLat[0] - next.userLngLat[0]) > posQ ||
        Math.abs(prev.userLngLat[1] - next.userLngLat[1]) > posQ
      ) {
        return false;
      }
    } else if (prev.userLngLat !== next.userLngLat) return false;

    if (prev.userAlongMeters != null && next.userAlongMeters != null) {
      if (Math.abs(prev.userAlongMeters - next.userAlongMeters) > 400) return false;
    } else if (prev.userAlongMeters !== next.userAlongMeters) return false;

    if (prev.driveRouteBearingDeg != null && next.driveRouteBearingDeg != null) {
      if (Math.abs(prev.driveRouteBearingDeg - next.driveRouteBearingDeg) > 2) return false;
    } else if (prev.driveRouteBearingDeg !== next.driveRouteBearingDeg) return false;

    if (prev.heading != null && next.heading != null) {
      if (Math.abs(prev.heading - next.heading) > 3) return false;
    } else if (prev.heading !== next.heading) return false;
  } else {
    if (prev.userLngLat !== next.userLngLat) return false;
    if (prev.userAlongMeters !== next.userAlongMeters) return false;
    if (prev.driveRouteBearingDeg !== next.driveRouteBearingDeg) return false;
    if (prev.heading !== next.heading) return false;
  }

  const skip = new Set<keyof Props>([
    "userLngLat",
    "userAlongMeters",
    "driveRouteBearingDeg",
    "heading",
  ]);
  for (const k of Object.keys(prev) as (keyof Props)[]) {
    if (skip.has(k)) continue;
    if (!Object.is(prev[k], next[k])) return false;
  }
  return true;
}
