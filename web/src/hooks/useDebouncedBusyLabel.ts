import { useEffect, useMemo, useState } from "react";

export type ActivityBusyInputs = {
  routing: boolean;
  bypassBusy: boolean;
  suggestLoading: boolean;
  isPlus: boolean;
  navigationStarted: boolean;
  planRoutesLength: number;
  trafficFetchDone: boolean;
  settingTrafficEnabled: boolean;
  mapboxToken: string | undefined;
  isOnline: boolean;
  stormLoading: boolean;
  advisoryLifeSafetyOn: boolean;
  stormCorridorAlertCount: number;
  stormMapFeatureCount: number;
};

export function resolveActivityBusyRaw(input: ActivityBusyInputs): string | null {
  const trafficBusy =
    input.isPlus &&
    input.navigationStarted &&
    input.planRoutesLength > 0 &&
    !input.trafficFetchDone &&
    input.settingTrafficEnabled &&
    Boolean(input.mapboxToken) &&
    input.isOnline;

  const stormBusy =
    input.stormLoading &&
    input.advisoryLifeSafetyOn &&
    input.stormCorridorAlertCount === 0 &&
    input.stormMapFeatureCount === 0;

  if (input.routing) return "Building routes…";
  if (input.bypassBusy) return "Checking alternates…";
  if (input.suggestLoading) return "Searching…";
  if (trafficBusy) return "Loading traffic…";
  if (stormBusy) return "Loading maps & advisories…";
  return null;
}

/** Debounced busy label for advisory / status pill — avoids rotator flicker. */
export function useDebouncedBusyLabel(input: ActivityBusyInputs): string | null {
  const activityBusyRaw = useMemo(() => resolveActivityBusyRaw(input), [
    input.routing,
    input.bypassBusy,
    input.suggestLoading,
    input.navigationStarted,
    input.planRoutesLength,
    input.trafficFetchDone,
    input.settingTrafficEnabled,
    input.mapboxToken,
    input.isOnline,
    input.stormLoading,
    input.stormCorridorAlertCount,
    input.stormMapFeatureCount,
    input.advisoryLifeSafetyOn,
    input.isPlus,
  ]);

  const [activityBusyLabel, setActivityBusyLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!activityBusyRaw) {
      const id = window.setTimeout(() => setActivityBusyLabel(null), 300);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setActivityBusyLabel(activityBusyRaw), 700);
    return () => window.clearTimeout(id);
  }, [activityBusyRaw]);

  return activityBusyLabel;
}
