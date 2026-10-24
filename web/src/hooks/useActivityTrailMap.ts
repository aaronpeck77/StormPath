import { useEffect, useMemo } from "react";
import {
  ACTIVITY_MIN_SAMPLES_PLANNING_MAP,
  activitySamplesToGeoJson,
  getActivityTrailPlanningBounds,
  loadActivitySamples,
} from "../frequentRoutes/activitySamples";
import {
  buildActivityTrailAboutPanel,
  type ActivityTrailAboutPanel,
} from "../frequentRoutes/buildActivityTrailAboutPanel";
import { boundsAroundLngLat, getHomePreloadBounds } from "../map/homePreloadRegion";
import { setOfflineHomeBounds } from "../map/offlineTileCache";
import { loadSavedPlaces } from "../nav/savedPlaces";
import type { HomeMapFraming } from "../map/homeMapFraming";

/** Basic users have no activity trail — a saved place named "home" is their home area. */
const SAVED_HOME_FALLBACK_RADIUS_M = 12_000;

export interface UseActivityTrailMapDeps {
  isPlus: boolean;
  activityTrailMapOn: boolean;
  setActivityTrailMapOn: (on: boolean) => void;
  activityTrailMapLsKey: string;
  learnEnabled: boolean;
  setLearnEnabled: (on: boolean) => void;
  homeMapFraming: HomeMapFraming;
  setHomeMapFraming: (mode: HomeMapFraming) => void;
  homePreloadEnabled: boolean;
  setHomePreloadEnabled: (on: boolean) => void;
  activityTrailTick: number;
  bumpActivityTrailTick: () => void;
}

export interface UseActivityTrailMapResult {
  activityTrailGeoJsonForMap: GeoJSON.FeatureCollection | null;
  activityTrailPlanningBounds: ReturnType<typeof getActivityTrailPlanningBounds>;
  homePreloadBounds: ReturnType<typeof getHomePreloadBounds>;
  activityTrailAboutPanel: ActivityTrailAboutPanel | null;
  idleHomeMapFraming: HomeMapFraming;
}

/** Activity-trail map overlay + About-panel data (personal-fork nav is a separate concern). */
export function useActivityTrailMap(deps: UseActivityTrailMapDeps): UseActivityTrailMapResult {
  const {
    isPlus,
    activityTrailMapOn,
    setActivityTrailMapOn,
    activityTrailMapLsKey,
    learnEnabled,
    setLearnEnabled,
    homeMapFraming,
    setHomeMapFraming,
    homePreloadEnabled,
    setHomePreloadEnabled,
    activityTrailTick,
    bumpActivityTrailTick,
  } = deps;

  const activityTrailGeoJsonForMap = useMemo(() => {
    if (!isPlus || !activityTrailMapOn) return null;
    const s = loadActivitySamples();
    if (!s.length) return null;
    return activitySamplesToGeoJson(s);
  }, [isPlus, activityTrailMapOn, activityTrailTick]);

  const activityTrailPlanningBounds = useMemo(() => {
    if (!isPlus || !learnEnabled) return null;
    return getActivityTrailPlanningBounds(ACTIVITY_MIN_SAMPLES_PLANNING_MAP);
  }, [isPlus, learnEnabled, activityTrailTick]);

  const homePreloadBounds = useMemo(() => {
    if (!homePreloadEnabled) return null;
    const trailBounds = isPlus && learnEnabled ? getHomePreloadBounds() : null;
    if (trailBounds) return trailBounds;
    /* No trail (Basic, or not enough dots): a saved place named "home" is the
     * home area — 12 km box, sized between MIN/MAX_PRELOAD_RADIUS_M. */
    const home = loadSavedPlaces().find((p) => p.name.trim().toLowerCase() === "home");
    if (home) return boundsAroundLngLat(home.lngLat, SAVED_HOME_FALLBACK_RADIUS_M);
    return null;
  }, [isPlus, learnEnabled, homePreloadEnabled, activityTrailTick]);

  /* The offline tile cache buckets home vs corridor tiles against these bounds —
   * keep IDB's meta copy in sync (worker-side eviction reads it independently). */
  const homePreloadBoundsKey = homePreloadBounds
    ? `${homePreloadBounds[0][0]},${homePreloadBounds[0][1]}|${homePreloadBounds[1][0]},${homePreloadBounds[1][1]}`
    : "";
  useEffect(() => {
    void setOfflineHomeBounds(homePreloadBounds);
  }, [homePreloadBoundsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activityTrailAboutPanel = useMemo(
    () =>
      buildActivityTrailAboutPanel({
        isPlus,
        learnEnabled,
        setLearnEnabled,
        activityTrailMapOn,
        setActivityTrailMapOn,
        activityTrailMapLsKey,
        homeMapFraming,
        setHomeMapFraming,
        homeAreaAvailable: activityTrailPlanningBounds != null,
        homePreloadEnabled,
        setHomePreloadEnabled,
        homePreloadBounds,
        bumpActivityTrailTick,
      }),
    [
      isPlus,
      activityTrailMapOn,
      activityTrailTick,
      learnEnabled,
      setLearnEnabled,
      homeMapFraming,
      activityTrailPlanningBounds,
      homePreloadEnabled,
      homePreloadBounds,
    ]
  );

  /** Prefer the saved home framing even before Plus settles — Basic has no trail bounds,
   *  so resolveIdleHomeFraming still lands on my_location. Forcing "my_location" while
   *  isPlus flickers was causing a street-zoom flash after the travel area framed. */
  const idleHomeMapFraming: HomeMapFraming = homeMapFraming;

  return {
    activityTrailGeoJsonForMap,
    activityTrailPlanningBounds,
    homePreloadBounds,
    activityTrailAboutPanel,
    idleHomeMapFraming,
  };
}
