import { useCallback } from "react";
import { useDriveMapProps, type UseDriveMapPropsInput } from "./useDriveMapProps";
import {
  buildStormAdvisoryBarProps,
  type BuildStormAdvisoryBarPropsInput,
} from "./buildStormAdvisoryBarProps";
import { useTripPlanStore } from "../state/tripPlanStore";
import { useSettingsStore } from "../state/settingsStore";
import { useWeatherStore } from "../state/weatherStore";
import { useUiStore } from "../state/uiStore";
import { useRouteCompareStore } from "../state/routeCompareStore";

/** Fields the hook now sources itself from `tripPlanStore` / `settingsStore` / `weatherStore` /
 * `uiStore` / `routeCompareStore` instead of App passing them through. */
type StoreSourcedDriveMapFields =
  | "navigationStarted"
  | "destLngLat"
  | "viaStops"
  | "viewMode"
  | "settingRadarDisplayMode"
  | "settingTrafficEnabled"
  | "mapFocus"
  | "onMapFocusComplete"
  | "stormBarExpanded"
  | "trafficBypassCompare"
  | "idleHomeNoRoutes";

type StoreSourcedStormAdvisoryFields =
  | "navigationStarted"
  | "stormBarExpanded"
  | "stormLoading"
  | "stormError"
  | "stormCorridorAlertsLength"
  | "stormMapHasFeatures";

type StormAdvisoryBarChromeInput = Omit<
  BuildStormAdvisoryBarPropsInput,
  | "onTrafficReroute"
  | "onOpenSubscription"
  | "onOpenDataSaverSettings"
  | "onDismissDataSaverHint"
  | StoreSourcedStormAdvisoryFields
> & {
  /** App decides CTA eligibility (feature flag + Plus + token + active route context). */
  trafficRerouteEligible: boolean;
  onTrafficBypassFromHere: () => void | Promise<void>;
  onOpenAbout: () => void;
  onDismissDataSaverHint: () => void;
};

export type UseAppMapChromePropsInput = {
  driveMap: Omit<UseDriveMapPropsInput, StoreSourcedDriveMapFields>;
  stormAdvisoryBar: StormAdvisoryBarChromeInput;
};

/**
 * Combines the DriveMap + StormAdvisoryBar prop-bag builders (Phase 3a/3b) into one call so
 * App.tsx owns a single hook invocation instead of two large adjacent object literals.
 *
 * Phase 4f: subscribes directly to the four state stores for the handful of fields that are
 * pure store reads (nav/view/dest state, radar + traffic settings, storm bar + alert counts,
 * map focus, route-compare) so App no longer has to thread them through both prop bags.
 */
export function useAppMapChromeProps(input: UseAppMapChromePropsInput) {
  const navigationStarted = useTripPlanStore((s) => s.navigationStarted);
  const destLngLat = useTripPlanStore((s) => s.destLngLat);
  const viaStops = useTripPlanStore((s) => s.viaStops);
  const viewMode = useTripPlanStore((s) => s.viewMode);
  const planRoutesLength = useTripPlanStore((s) => s.plan.routes.length);
  const settingRadarDisplayMode = useSettingsStore((s) => s.radarDisplayMode);
  const settingTrafficEnabled = useSettingsStore((s) => s.trafficEnabled);
  const stormBarExpanded = useWeatherStore((s) => s.stormBarExpanded);
  const stormLoading = useWeatherStore((s) => s.stormLoading);
  const stormError = useWeatherStore((s) => s.stormError);
  const stormCorridorAlertsLength = useWeatherStore((s) => s.stormCorridorAlerts.length);
  const stormMapHasFeatures = useWeatherStore((s) => Boolean(s.stormMapGeoJson?.features?.length));
  const mapFocus = useUiStore((s) => s.mapFocus);
  const setMapFocus = useUiStore((s) => s.setMapFocus);
  const trafficBypassCompare = useRouteCompareStore((s) => s.trafficBypassCompare);

  const onMapFocusComplete = useCallback(() => setMapFocus(null), [setMapFocus]);

  const driveMapProps = useDriveMapProps({
    ...input.driveMap,
    navigationStarted,
    destLngLat,
    viaStops,
    viewMode,
    settingRadarDisplayMode,
    settingTrafficEnabled,
    mapFocus,
    onMapFocusComplete,
    stormBarExpanded,
    trafficBypassCompare,
    idleHomeNoRoutes: planRoutesLength === 0,
  });

  const {
    trafficRerouteEligible,
    onTrafficBypassFromHere,
    onOpenAbout,
    onDismissDataSaverHint,
    ...restStormAdvisoryBar
  } = input.stormAdvisoryBar;

  const stormAdvisoryBarProps = buildStormAdvisoryBarProps({
    ...restStormAdvisoryBar,
    navigationStarted,
    stormBarExpanded,
    stormLoading,
    stormError,
    stormCorridorAlertsLength,
    stormMapHasFeatures,
    onTrafficReroute: trafficRerouteEligible ? () => void onTrafficBypassFromHere() : undefined,
    onOpenSubscription: onOpenAbout,
    onOpenDataSaverSettings: onOpenAbout,
    onDismissDataSaverHint: () => {
      onDismissDataSaverHint();
    },
  });

  return { driveMapProps, stormAdvisoryBarProps };
}
