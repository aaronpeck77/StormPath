import type { RouteAlert } from "./routeAlerts";
import { pointAtAlongMeters } from "./routeGeometry";
import type { LngLat } from "./types";

/**
 * Place corridor alerts on the strip in the **remaining** part of the trip (ahead of the driver),
 * so marks sit in the “forward” section of the bar instead of fixed fractions of the whole line.
 */
export function layoutStripAlerts(
  alerts: RouteAlert[],
  geometry: LngLat[],
  userAlongMeters: number,
  totalMeters: number
): RouteAlert[] {
  if (!geometry.length || totalMeters <= 0) return alerts;
  const rem = Math.max(30, totalMeters - userAlongMeters);

  return alerts.map((a, i) => {
    let along = a.alongMeters;
    if (!Number.isFinite(along) || along <= userAlongMeters + 10) {
      let frac = 0.38 + (i % 6) * 0.09;
      if (a.id === "traffic-delay" || a.id === "traffic" || a.id === "traffic-live")
        frac = 0.28 + (i % 3) * 0.06;
      else if (a.id === "radar" || a.id === "wx-headline") frac = 0.52 + (i % 2) * 0.08;
      else if (a.id.startsWith("hazard-")) frac = 0.18 + (i % 5) * 0.11;
      along = userAlongMeters + rem * Math.min(0.94, frac);
    }
    along = Math.max(userAlongMeters + 14, Math.min(totalMeters - 5, along));
    return {
      ...a,
      alongMeters: along,
      lngLat: pointAtAlongMeters(geometry, along),
    };
  });
}
