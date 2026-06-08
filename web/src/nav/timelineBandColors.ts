/**
 * Timeline / progress-strip band colors — weather vs road families aligned with
 * {@link corridorHighlightHex} (map casing + progress strip) and NWS line colors.
 */

import { corridorHighlightHex } from "./routeAlerts";
import { nwsAlertLineColorHex } from "../weatherAlerts/geometryOverlap";
import type { TimelineItem } from "../ui/RouteHazardTimeline";

export type TimelineBandFamily = "weather" | "road";

export function timelineTrackFamily(track: TimelineItem["track"]): TimelineBandFamily {
  return track === "road" ? "road" : "weather";
}

export function timelineSeverityToCorridorLevel(severity: TimelineItem["severity"]): number {
  switch (severity) {
    case "avoid":
      return 90;
    case "serious":
      return 75;
    case "caution":
      return 58;
    default:
      return 40;
  }
}

function nwsTimelineSeverityLabel(severity: TimelineItem["severity"]): string {
  switch (severity) {
    case "avoid":
      return "Extreme";
    case "serious":
      return "Severe";
    case "caution":
      return "Moderate";
    default:
      return "Minor";
  }
}

/** Band fill for timeline rails, progress strip, and glance hazard bars. */
export function timelineItemBandColor(item: TimelineItem): string {
  if (item.track === "nws") {
    return nwsAlertLineColorHex(nwsTimelineSeverityLabel(item.severity));
  }

  const level = timelineSeverityToCorridorLevel(item.severity);

  if (item.track === "road") {
    return corridorHighlightHex("traffic", level);
  }

  /* radar + forecast — violet / sky weather casing (MapKey "weather on route") */
  return corridorHighlightHex("weather", level);
}
