import type { TimelineItem } from "./routeAheadSync";
import { timelineItemBandColor } from "./timelineBandColors";
import type { MapViewMode } from "../ui/driveMapTypes";

export type DriveHazardTickerInput = {
  items: readonly TimelineItem[];
  isPlus: boolean;
  isOnline: boolean;
  navigationStarted: boolean;
  viewMode: MapViewMode;
  userAlongMeters: number;
  metersToManeuver: number | null;
  miles: boolean;
  offRoute?: boolean;
};

const SEVERITY = { info: 0, caution: 1, serious: 2, avoid: 3 };

export function selectDriveHazardTicker(input: DriveHazardTickerInput, nowMs = Date.now()) {
  const { userAlongMeters: along, metersToManeuver: turnM } = input;
  if (!input.isPlus || !input.isOnline || !input.navigationStarted || input.offRoute || input.viewMode !== "drive" ||
    !Number.isFinite(along) || along < 0 || turnM == null || !Number.isFinite(turnM) || turnM <= 1609.34) return null;

  const candidates = input.items.filter((item) => {
    if (item.crossesRoute === false || item.stripMuted || item.coarsePreview || item.etaStale ||
      item.severity === "info" || !item.label.trim() || !Number.isFinite(item.startMeters) ||
      !Number.isFinite(item.endMeters) || item.startMeters < 0 || item.endMeters < item.startMeters ||
      item.endMeters <= along) return false;
    if (item.expiresIso) {
      const expiry = Date.parse(item.expiresIso);
      if (!Number.isFinite(expiry) || expiry <= nowMs) return false;
    }
    return true;
  });
  candidates.sort((a, b) => Math.max(0, a.startMeters - along) - Math.max(0, b.startMeters - along) ||
    SEVERITY[b.severity] - SEVERITY[a.severity] || a.id.localeCompare(b.id));
  const item = candidates[0];
  if (!item) return null;
  const ahead = Math.max(0, item.startMeters - along);
  const distance = ahead / (input.miles ? 1609.34 : 1000);
  const unit = input.miles ? "mi" : "km";
  const distanceLabel = ahead === 0
    ? item.developingLater ? "Possible here" : "Here now"
    : `${distance < 0.1 ? "<0.1" : distance < 10 ? distance.toFixed(1) : Math.round(distance)} ${unit}`;
  return {
    id: item.id,
    label: `${item.developingLater ? "Possible: " : ""}${item.label.trim()}`,
    distanceLabel,
    color: timelineItemBandColor(item),
  };
}
