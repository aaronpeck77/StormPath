import {
  clearActivitySamples,
  getActivityTrailStats,
} from "./activitySamples";
import {
  clearHomePreloadRecord,
  estimatePreloadStorageLabel,
  writeHomePreloadEnabled,
} from "../map/homePreloadRegion";
import type { HomeMapFraming } from "../map/homeMapFraming";
import { writeHomeMapFraming } from "../map/homeMapFraming";
import { safeStorage } from "../storage/safeStorage";

export type ActivityTrailAboutPanel = {
  count: number;
  spanDays: number | null;
  oldestLabel: string;
  newestLabel: string;
  learnEnabled: boolean;
  onLearnEnabledChange: (on: boolean) => void;
  showOnMap: boolean;
  onShowOnMapChange: (on: boolean) => void;
  homeMapFraming: HomeMapFraming;
  onHomeMapFramingChange: (mode: HomeMapFraming) => void;
  homeAreaAvailable: boolean;
  homePreloadEnabled: boolean;
  onHomePreloadEnabledChange: (on: boolean) => void;
  homePreloadAvailable: boolean;
  homePreloadSizeLabel: string | null;
  onClear: () => void;
};

type LngLatBounds = [[number, number], [number, number]];

/** Build the About → Activity trail panel model (Plus only). */
export function buildActivityTrailAboutPanel(input: {
  isPlus: boolean;
  learnEnabled: boolean;
  setLearnEnabled: (on: boolean) => void;
  activityTrailMapOn: boolean;
  setActivityTrailMapOn: (on: boolean) => void;
  activityTrailMapLsKey: string;
  homeMapFraming: HomeMapFraming;
  setHomeMapFraming: (mode: HomeMapFraming) => void;
  homeAreaAvailable: boolean;
  homePreloadEnabled: boolean;
  setHomePreloadEnabled: (on: boolean) => void;
  homePreloadBounds: LngLatBounds | null;
  bumpActivityTrailTick: () => void;
}): ActivityTrailAboutPanel | null {
  if (!input.isPlus) return null;
  const s = getActivityTrailStats();
  const fmt = (ts: number | null) =>
    ts == null
      ? "—"
      : new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return {
    count: s.count,
    spanDays: s.spanDays,
    oldestLabel: fmt(s.oldest),
    newestLabel: fmt(s.newest),
    learnEnabled: input.learnEnabled,
    onLearnEnabledChange: input.setLearnEnabled,
    showOnMap: input.activityTrailMapOn,
    onShowOnMapChange: (on: boolean) => {
      input.setActivityTrailMapOn(on);
      safeStorage.set(input.activityTrailMapLsKey, on ? "1" : "0");
    },
    homeMapFraming: input.homeMapFraming,
    onHomeMapFramingChange: (mode: HomeMapFraming) => {
      input.setHomeMapFraming(mode);
      writeHomeMapFraming(mode);
    },
    homeAreaAvailable: input.homeAreaAvailable,
    homePreloadEnabled: input.homePreloadEnabled,
    onHomePreloadEnabledChange: (on: boolean) => {
      input.setHomePreloadEnabled(on);
      writeHomePreloadEnabled(on);
    },
    homePreloadAvailable: input.homePreloadBounds != null,
    homePreloadSizeLabel: estimatePreloadStorageLabel(input.homePreloadBounds),
    onClear: () => {
      clearActivitySamples();
      clearHomePreloadRecord();
      input.bumpActivityTrailTick();
    },
  };
}
