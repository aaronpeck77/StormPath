import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  formatDetourRejoinDistanceM,
  isReverseRejoinRoute,
  metersRemainingToRejoinOnLockedRoute,
} from "./detourRejoin";
import {
  resolveDrivingRejoinContext,
  shouldLatchHighwayAfterSurface,
  type DrivingRejoinMode,
  type RoadNetworkClass,
} from "./drivingRejoinContext";
import { remainingViaStops } from "./routeWaypoints";
import { collectMapboxRouteVariants } from "../services/mapboxDirectionsRouter";
import { speakNavigationAlert } from "./navigationVoiceAlert";
import {
  DRIVE_AHEAD_HEADING_DELTA_DEG,
  DRIVE_AHEAD_HEADING_MIN_LATERAL_M,
  DRIVE_AHEAD_MIN_SPEED_MPS,
  DRIVE_AHEAD_NAV_START_GRACE_ALONG_M,
  DRIVE_AHEAD_NAV_START_GRACE_MAX_LATERAL_M,
  DRIVE_AHEAD_NAV_START_GRACE_MS,
  DRIVE_AHEAD_OFF_ROUTE_ENTER_M,
  DRIVE_AHEAD_REROUTE_THROTTLE_MS,
  isDriveAlwaysAheadView,
  lockedRouteShouldAvoidMotorway,
} from "./driveAlwaysAhead";
import { mayMutateLockedRouteGeometry } from "./navigationContract";
import { planAfterSoftRestartLock } from "./softRestartPlan";
import {
  OFF_ROUTE_POLL_MS,
  OFF_ROUTE_REROUTE_THROTTLE_MS,
  measureOffRouteLateral,
  shouldOfferOffRouteRejoin,
} from "./offRouteDetect";
import {
  isAutoOffRouteRerouteActive,
  MANUAL_OFF_ROUTE_CHOICES_ENABLED,
  shouldShowManualOffRouteUi,
} from "./constants";
import {
  activeTurnStepIndexAlong,
  metersToCurrentStepEnd,
  turnStepAlongBounds,
} from "./turnStepAlong";
import {
  createOffRoutePollSession,
  resetOffRoutePollSession,
  runOffRoutePollTick,
  type OffRoutePollSession,
} from "./offRoutePollLogic";
import { offRouteEnterThresholdM } from "./offRouteRecoveryPolicy";
import {
  bearingAlongRouteAhead,
  initialBearingDegrees,
  pointAtAlongMeters,
  polylineLengthMeters,
} from "./routeGeometry";
import {
  buildCumulativeDistances,
  buildCumulativeDistancesAsync,
} from "./routeGeometryWorkerClient";
import type { LngLat, NavRoute, TripPlan } from "./types";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { TripStop } from "./routeWaypoints";
import { isAbortError, routeFetchUserMessage } from "../utils/fetchResilient";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";

export interface UseOffRouteNavigationDeps {
  userLngLat: LngLat | null;
  destLngLat: LngLat | null;
  plan: TripPlan;
  orderedRouteIds: string[];
  viaStops: TripStop[];
  activeViaIndex: number;
  destinationLabel: string;
  navigationStarted: boolean;
  guidanceRoute: NavRoute | null | undefined;
  guidanceRouteLengthM: number;
  guidanceRouteId: string;
  userAlongGuidanceMRef: MutableRefObject<number>;
  effectiveUserLngLat: LngLat | null;
  mapboxToken: string;
  isOnline: boolean;
  isPlus: boolean;
  effectiveAutoRerouteEnabled: boolean;
  settingVoiceGuidanceEnabled: boolean;
  settingStormEnabled: boolean;
  stormAlertsForRouting: NormalizedWeatherAlert[] | undefined;
  lockedNavigationRouteIdRef: MutableRefObject<string | null>;
  routeGraphEpochRef: MutableRefObject<number>;
  altRoutesFetchAbortRef: MutableRefObject<AbortController | null>;
  altRoutesRefreshInFlightRef: MutableRefObject<boolean>;
  navigationStartedRef: MutableRefObject<boolean>;
  guidanceRouteGeomRef: MutableRefObject<LngLat[] | null>;
  userLngLatRef: MutableRefObject<LngLat | null>;
  speedMpsRef: MutableRefObject<number | null>;
  headingRef: MutableRefObject<number | null>;
  navGoStartedAtRef: MutableRefObject<number | null>;
  planRef: MutableRefObject<TripPlan>;
  destLngLatRef: MutableRefObject<LngLat | null>;
  routingRef: MutableRefObject<boolean>;
  setPlan: (updater: TripPlan | ((prev: TripPlan) => TripPlan)) => void;
  setDestLngLat: (v: LngLat | null) => void;
  setRouteSlotOrder: (updater: (prev: string[]) => string[]) => void;
  setViewMode: (mode: MapViewMode | ((prev: MapViewMode) => MapViewMode)) => void;
  setRouting: (busy: boolean) => void;
  setRouteError: (msg: string | null) => void;
  setTapHint: (msg: string | null) => void;
  setFitTrigger: (updater: (prev: number) => number) => void;
  /** Updates full guidance geometry after the driver adopts a new locked path. */
  adoptLockedRouteGeometry: (geometry: LngLat[], opts?: { force?: boolean }) => void;
  viewModeRef: MutableRefObject<MapViewMode>;
  /**
   * When true, driver is following a learned personal fork — suppress main-corridor
   * rejoin / hold preview / drive-ahead replan toward the old highway leg.
   */
  onPersonalForkRef?: MutableRefObject<boolean>;
}

export type RecalcRouteFromHereFn = (opts?: { silent?: boolean }) => Promise<boolean>;
export type StayOnThisRoadFn = (opts?: { silent?: boolean }) => Promise<boolean>;
export type ReturnToOriginalRouteFn = () => void;

/** Off-route detection — soft-restarts the locked corridor from GPS when confirmed. */
export function useOffRouteNavigation(deps: UseOffRouteNavigationDeps) {
  const {
    userLngLat,
    destLngLat,
    plan,
    orderedRouteIds,
    viaStops,
    activeViaIndex,
    navigationStarted,
    guidanceRoute,
    guidanceRouteLengthM,
    guidanceRouteId,
    userAlongGuidanceMRef,
    effectiveUserLngLat,
    mapboxToken,
    isOnline,
    isPlus,
    effectiveAutoRerouteEnabled,
    settingVoiceGuidanceEnabled,
    settingStormEnabled,
    stormAlertsForRouting,
    lockedNavigationRouteIdRef,
    routeGraphEpochRef,
    altRoutesFetchAbortRef,
    altRoutesRefreshInFlightRef,
    navigationStartedRef,
    guidanceRouteGeomRef,
    userLngLatRef,
    speedMpsRef,
    headingRef,
    navGoStartedAtRef,
    planRef,
    destLngLatRef,
    routingRef,
    setPlan,
    setRouteSlotOrder,
    setViewMode,
    setRouting,
    setRouteError,
    setTapHint,
    setFitTrigger,
    adoptLockedRouteGeometry,
    viewModeRef,
    onPersonalForkRef,
  } = deps;

  const [offRouteSevere, setOffRouteSevere] = useState(false);
  const [offRouteLatched, setOffRouteLatched] = useState(false);
  const [offRouteRejoinAlongM, setOffRouteRejoinAlongM] = useState(0);
  const [offRouteAwaitingDriverChoice, setOffRouteAwaitingDriverChoice] = useState(false);
  const offRouteSevereRef = useRef(false);
  const offRouteLatchedRef = useRef(false);
  const offRouteRerouteFailStreakRef = useRef(0);
  const offRouteRejoinAlongMRef = useRef(0);
  const [detourRejoinAlongM, setDetourRejoinAlongM] = useState(0);
  const detourRejoinAlongMRef = useRef(0);
  detourRejoinAlongMRef.current = detourRejoinAlongM;
  const [autoRejoinGuidanceRouteId, setAutoRejoinGuidanceRouteId] = useState<string | null>(null);
  const autoRejoinGuidanceRouteIdRef = useRef<string | null>(null);
  autoRejoinGuidanceRouteIdRef.current = autoRejoinGuidanceRouteId;
  const [holdRejoinPreviewActive, setHoldRejoinPreviewActive] = useState(false);
  const holdRejoinPreviewActiveRef = useRef(false);
  const [holdRejoinPreviewRouteId, setHoldRejoinPreviewRouteId] = useState<string | null>(null);
  const holdRejoinPreviewRouteIdRef = useRef<string | null>(null);
  holdRejoinPreviewRouteIdRef.current = holdRejoinPreviewRouteId;
  const [holdRejoinPreviewAlongM, setHoldRejoinPreviewAlongM] = useState(0);
  const holdRejoinPreviewAlongMRef = useRef(0);
  holdRejoinPreviewAlongMRef.current = holdRejoinPreviewAlongM;
  const lastHoldPreviewFetchRef = useRef(0);
  const holdPreviewFetchInFlightRef = useRef(false);
  const pollSessionRef = useRef<OffRoutePollSession>(createOffRoutePollSession());
  const lastOffRouteSampleRef = useRef<{ t: number; lateralM: number; alongM: number } | null>(
    null
  );
  const drivingRejoinRoadClassRef = useRef<RoadNetworkClass>("unknown");
  const drivingRejoinSurfaceAtRef = useRef<number | null>(null);
  const drivingRejoinModeRef = useRef<DrivingRejoinMode>("manual");
  const guidanceRouteLengthMRef = useRef(guidanceRouteLengthM);
  guidanceRouteLengthMRef.current = guidanceRouteLengthM;
  const guidanceCumDistRef = useRef<Float64Array | null>(null);
  const guidanceGeomSigRef = useRef("");
  const lastAutoRerouteAttemptRef = useRef(0);

  useEffect(() => {
    const g = guidanceRoute?.geometry;
    const sig =
      g && g.length >= 2
        ? `${g.length}:${g[0]![0].toFixed(5)}:${g[g.length - 1]![0].toFixed(5)}`
        : "";
    if (sig === guidanceGeomSigRef.current) return;
    guidanceGeomSigRef.current = sig;
    if (!g || g.length < 2) {
      guidanceCumDistRef.current = null;
      return;
    }
    guidanceCumDistRef.current = buildCumulativeDistances(g);
    let cancelled = false;
    void buildCumulativeDistancesAsync(g).then((asyncCum) => {
      if (!cancelled && guidanceGeomSigRef.current === sig) {
        guidanceCumDistRef.current = asyncCum;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [guidanceRoute?.geometry, guidanceRouteId]);

  const syncPollSessionFromRefs = useCallback(() => {
    pollSessionRef.current = {
      ...pollSessionRef.current,
      offRouteSevere,
      detourRejoinAlongM,
      autoRejoinGuidanceRouteId,
      offRouteRejoinAlongM: offRouteRejoinAlongMRef.current,
    };
  }, [offRouteSevere, detourRejoinAlongM, autoRejoinGuidanceRouteId]);

  const applyPollSession = useCallback((session: OffRoutePollSession) => {
    pollSessionRef.current = session;
    offRouteRejoinAlongMRef.current = session.offRouteRejoinAlongM;
    if (offRouteLatchedRef.current !== session.offRouteLatched) {
      offRouteLatchedRef.current = session.offRouteLatched;
      setOffRouteLatched(session.offRouteLatched);
    }
    setOffRouteRejoinAlongM((prev) =>
      prev === session.offRouteRejoinAlongM ? prev : session.offRouteRejoinAlongM
    );
    if (offRouteSevereRef.current !== session.offRouteSevere) {
      offRouteSevereRef.current = session.offRouteSevere;
      setOffRouteSevere(session.offRouteSevere);
    }
    if (detourRejoinAlongMRef.current !== session.detourRejoinAlongM) {
      detourRejoinAlongMRef.current = session.detourRejoinAlongM;
      setDetourRejoinAlongM(session.detourRejoinAlongM);
    }
    if (autoRejoinGuidanceRouteIdRef.current !== session.autoRejoinGuidanceRouteId) {
      autoRejoinGuidanceRouteIdRef.current = session.autoRejoinGuidanceRouteId;
      setAutoRejoinGuidanceRouteId(session.autoRejoinGuidanceRouteId);
    }
  }, []);

  const clearHoldRejoinPreview = useCallback(() => {
    const hadPreview = holdRejoinPreviewActiveRef.current;
    holdRejoinPreviewActiveRef.current = false;
    setHoldRejoinPreviewActive(false);
    holdRejoinPreviewRouteIdRef.current = null;
    setHoldRejoinPreviewRouteId(null);
    holdRejoinPreviewAlongMRef.current = 0;
    setHoldRejoinPreviewAlongM(0);
    if (hadPreview && navigationStartedRef.current && viewModeRef.current === "topdown") {
      setViewMode("drive");
    }
  }, [setViewMode, navigationStartedRef, viewModeRef]);

  const resetOffRouteNavigation = useCallback(() => {
    pollSessionRef.current = resetOffRoutePollSession(pollSessionRef.current);
    offRouteSevereRef.current = false;
    setOffRouteSevere(false);
    offRouteLatchedRef.current = false;
    setOffRouteLatched(false);
    setOffRouteRejoinAlongM(0);
    offRouteRejoinAlongMRef.current = 0;
    setOffRouteAwaitingDriverChoice(false);
    setDetourRejoinAlongM(0);
    detourRejoinAlongMRef.current = 0;
    setAutoRejoinGuidanceRouteId(null);
    autoRejoinGuidanceRouteIdRef.current = null;
    holdRejoinPreviewActiveRef.current = false;
    setHoldRejoinPreviewActive(false);
    holdRejoinPreviewRouteIdRef.current = null;
    setHoldRejoinPreviewRouteId(null);
    holdRejoinPreviewAlongMRef.current = 0;
    setHoldRejoinPreviewAlongM(0);
    lastHoldPreviewFetchRef.current = 0;
    holdPreviewFetchInFlightRef.current = false;
    lastOffRouteSampleRef.current = null;
    drivingRejoinRoadClassRef.current = "unknown";
    drivingRejoinSurfaceAtRef.current = null;
    drivingRejoinModeRef.current = "manual";
  }, []);

  const clearDetourGuidance = useCallback(() => {
    setAutoRejoinGuidanceRouteId(null);
    autoRejoinGuidanceRouteIdRef.current = null;
    setDetourRejoinAlongM(0);
    detourRejoinAlongMRef.current = 0;
    pollSessionRef.current = {
      ...pollSessionRef.current,
      autoRejoinGuidanceRouteId: null,
      detourRejoinAlongM: 0,
    };
  }, []);

  const prefetchHoldRejoinPreview = useCallback(async () => {
    /* Soft restart owns off-route recovery. Hold-preview B/C overlays left Rt/Mp
     * with a line while Drive stayed on the frozen Go lock (empty / sideways). */
  }, []);

  /**
   * Soft restart: keep destination / vias / trip session, replace locked geometry with a
   * fresh forward GPS→dest route, and put Drive / Route / Map on that same line.
   * Not a full Stop — progress rail rebuilds from the new geometry via along reset.
   */
  const softRestartRouteFromHere = useCallback<StayOnThisRoadFn>(async (opts) => {
    if (!userLngLat || !destLngLat) return false;
    if (
      navigationStartedRef.current &&
      !mayMutateLockedRouteGeometry("navigating", "off_route_soft_restart")
    ) {
      return false;
    }
    if (mapboxToken && !isOnline) {
      if (!opts?.silent) {
        setTapHint("Offline: can't update route from here.");
        window.setTimeout(() => setTapHint(null), 3500);
      }
      return false;
    }
    const lockedId = lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? null;
    if (!lockedId || !navigationStartedRef.current || !mapboxToken) return false;

    const lockedRoute = planRef.current.routes.find((r) => r.id === lockedId);
    const preferBackroads = lockedRouteShouldAvoidMotorway(lockedRoute, planRef.current.routes);
    const preserveRole = lockedRoute?.role ?? (preferBackroads ? "hazardSmart" : "fastest");

    altRoutesFetchAbortRef.current?.abort();
    const fetchCtrl = new AbortController();
    altRoutesFetchAbortRef.current = fetchCtrl;
    altRoutesRefreshInFlightRef.current = true;
    setRouting(true);
    setRouteError(null);
    clearDetourGuidance();
    clearHoldRejoinPreview();
    setOffRouteAwaitingDriverChoice(false);

    const epochAtStart = routeGraphEpochRef.current;
    try {
      const remainingVias = remainingViaStops(viaStops, activeViaIndex);
      const viaCoords = remainingVias.map((s) => s.lngLat);
      const bearingDeg = headingRef.current;
      /** Keep the driver's chosen style (e.g. no-interstate B) — do not force highway fastest. */
      const fresh = await collectMapboxRouteVariants(mapboxToken, userLngLat, destLngLat, {
        via: viaCoords.length > 0 ? viaCoords : undefined,
        singleRouteFromPosition: true,
        forwardFirst: true,
        bearingDeg:
          bearingDeg != null && Number.isFinite(bearingDeg) ? bearingDeg : undefined,
        preferBackroads,
        signal: fetchCtrl.signal,
        stormAlerts: stormAlertsForRouting,
        radarAvoidanceEnabled: isPlus && settingStormEnabled,
      });
      const forward = fresh.filter(
        (r) =>
          r.geometry.length >= 2 &&
          !isReverseRejoinRoute(r, userLngLat, bearingDeg)
      );
      const leg = forward[0] ?? fresh[0];
      if (!leg?.geometry?.length || epochAtStart !== routeGraphEpochRef.current) return false;

      /* One Go-like lock — drop stale B/C / rejoin overlays that leave Drive empty. */
      setPlan((prev) =>
        planAfterSoftRestartLock(prev, lockedId, {
          geometry: leg.geometry,
          baseEtaMinutes: leg.baseEtaMinutes,
          turnSteps: leg.turnSteps,
          routeNotices: leg.routeNotices,
          routeNoticeAlongMeters: leg.routeNoticeAlongMeters,
          mapboxIncidents: leg.mapboxIncidents,
          hasTolls: leg.hasTolls,
          tollLabels: leg.tollLabels,
          postedSpeedSamples: leg.postedSpeedSamples,
          role: preserveRole,
          label: preferBackroads ? "No interstate" : "Main",
        })
      );
      setRouteSlotOrder(() => [lockedId]);
      adoptLockedRouteGeometry(leg.geometry.map(([a, b]) => [a, b] as LngLat), {
        force: true,
      });
      /* Clean slate on the new corridor — same trip, not a Stop. */
      applyPollSession(resetOffRoutePollSession(pollSessionRef.current));
      offRouteRerouteFailStreakRef.current = 0;
      setFitTrigger((n) => n + 1);
      setViewMode("drive");
      const voiceLine = opts?.silent ? "Updating your route." : "Following your chosen path.";
      speakNavigationAlert(voiceLine, settingVoiceGuidanceEnabled);
      if (!opts?.silent) {
        setTapHint("Updated route from here.");
        window.setTimeout(() => setTapHint(null), 5000);
      }
      return true;
    } catch (e) {
      if (isAbortError(e)) return false;
      const msg = routeFetchUserMessage(e) ?? (e instanceof Error ? e.message : String(e));
      setRouteError(msg);
      if (!opts?.silent) {
        setTapHint("Could not update route — try again.");
        window.setTimeout(() => setTapHint(null), 5000);
      }
      if (MANUAL_OFF_ROUTE_CHOICES_ENABLED) {
        setOffRouteAwaitingDriverChoice(true);
      }
      return false;
    } finally {
      setRouting(false);
      altRoutesRefreshInFlightRef.current = false;
    }
  }, [
    userLngLat,
    destLngLat,
    mapboxToken,
    isOnline,
    orderedRouteIds,
    viaStops,
    activeViaIndex,
    stormAlertsForRouting,
    isPlus,
    settingStormEnabled,
    headingRef,
    lockedNavigationRouteIdRef,
    routeGraphEpochRef,
    altRoutesFetchAbortRef,
    altRoutesRefreshInFlightRef,
    navigationStartedRef,
    clearDetourGuidance,
    clearHoldRejoinPreview,
    setPlan,
    setRouteSlotOrder,
    adoptLockedRouteGeometry,
    applyPollSession,
    setRouting,
    setRouteError,
    setTapHint,
    setFitTrigger,
    setViewMode,
    settingVoiceGuidanceEnabled,
    planRef,
  ]);

  /** @deprecated Overlay rejoin removed — same as soft restart (new Go lock from GPS). */
  const recalcRouteFromHere = softRestartRouteFromHere;

  const stayOnThisRoad = useCallback<StayOnThisRoadFn>(
    async (opts) => softRestartRouteFromHere(opts),
    [softRestartRouteFromHere]
  );

  const returnToOriginalRoute = useCallback<ReturnToOriginalRouteFn>(() => {
    setOffRouteAwaitingDriverChoice(false);
    void softRestartRouteFromHere({ silent: false });
  }, [softRestartRouteFromHere]);

  const markRecoveryFailed = useCallback(() => {
    pollSessionRef.current = {
      ...pollSessionRef.current,
      offRouteChoiceOffered: false,
      offRouteRecoveryCommitted: false,
      offRouteRecoveryLastFailMs: Date.now(),
    };
  }, []);

  const executeAutoRecovery = useCallback(
    async (_action: "rejoin" | "replan") => {
      const driveAhead = isDriveAlwaysAheadView(viewModeRef.current);
      const throttleMs = driveAhead ? DRIVE_AHEAD_REROUTE_THROTTLE_MS : OFF_ROUTE_REROUTE_THROTTLE_MS;
      const now = Date.now();
      if (
        routingRef.current ||
        altRoutesRefreshInFlightRef.current ||
        now - lastAutoRerouteAttemptRef.current < throttleMs
      ) {
        return;
      }
      lastAutoRerouteAttemptRef.current = now;

      pollSessionRef.current = {
        ...pollSessionRef.current,
        offRouteChoiceOffered: true,
      };

      /* Soft restart from GPS — same trip, new locked ahead line for Dr/Rt/Mp. */
      const restarted = await softRestartRouteFromHere({ silent: true });
      if (!restarted) markRecoveryFailed();
    },
    [
      softRestartRouteFromHere,
      markRecoveryFailed,
      routingRef,
      altRoutesRefreshInFlightRef,
      viewModeRef,
    ]
  );

  useEffect(() => {
    pollSessionRef.current = {
      ...pollSessionRef.current,
      offRouteLatched: false,
      offRouteConfirmStreak: 0,
    };
  }, [guidanceRouteId]);

  useEffect(() => {
    if (!navigationStarted || !guidanceRoute?.geometry?.length || !destLngLat) {
      resetOffRouteNavigation();
      return;
    }

    const useRecoveryLadder = isAutoOffRouteRerouteActive(effectiveAutoRerouteEnabled);

    const offerRejoinChoices = (
      lateralM: number,
      recovery: "rejoin" | "replan" | null
    ) => {
      const driveAhead = isDriveAlwaysAheadView(viewModeRef.current);
      const session = pollSessionRef.current;
      if (!driveAhead) {
        if (session.offRouteChoiceOffered && !recovery) return;
        if (!shouldOfferOffRouteRejoin(lateralM, session.offRouteReofferBlockedUntil)) {
          return;
        }
        if (!session.offRouteChoiceOffered) {
          pollSessionRef.current = { ...session, offRouteChoiceOffered: true };
        }
      }

      if (useRecoveryLadder || driveAhead) {
        void executeAutoRecovery(recovery ?? "rejoin");
        return;
      }

      if (!MANUAL_OFF_ROUTE_CHOICES_ENABLED) return;

      const lockedRoute = planRef.current.routes.find(
        (r) => r.id === lockedNavigationRouteIdRef.current
      );
      const ctx =
        lockedRoute?.geometry?.length
          ? resolveDrivingRejoinContext({
              guidanceRoute: lockedRoute,
              userAlongM: offRouteRejoinAlongMRef.current || userAlongGuidanceMRef.current,
              destLngLat: destLngLatRef.current,
              latchedRoadClass: drivingRejoinRoadClassRef.current,
            })
          : null;
      drivingRejoinModeRef.current = ctx?.mode ?? "manual";

      setOffRouteAwaitingDriverChoice(true);
      setViewMode("drive");
      setTapHint("Off your route — stay on this road or return to your original route.");
      window.setTimeout(() => setTapHint(null), 8000);
    };

    const tick = () => {
      syncPollSessionFromRefs();
      const pos = userLngLatRef.current;
      const geom = guidanceRouteGeomRef.current;
      if (!pos || !geom?.length) return;

      const lockedRoute = planRef.current.routes.find(
        (r) => r.id === lockedNavigationRouteIdRef.current
      );
      const lockedGeom =
        lockedRoute?.geometry && lockedRoute.geometry.length >= 2
          ? lockedRoute.geometry
          : geom;
      const pollGeom = lockedGeom.length >= 2 ? lockedGeom : geom;

      const totalM =
        pollGeom === lockedGeom && lockedRoute
          ? polylineLengthMeters(lockedGeom)
          : guidanceRouteLengthMRef.current > 0
            ? guidanceRouteLengthMRef.current
            : polylineLengthMeters(pollGeom);

      const alongForPoll = measureOffRouteLateral(
        pos,
        pollGeom,
        userAlongGuidanceMRef.current
      ).alongM;

      if (lockedRoute?.geometry?.length) {
        const sampleAlong = measureOffRouteLateral(pos, lockedGeom, alongForPoll);
        const instantRoad = resolveDrivingRejoinContext({
          guidanceRoute: lockedRoute,
          userAlongM: sampleAlong.alongM,
          destLngLat: destLngLatRef.current,
        }).roadClass;
        const prevRoad = drivingRejoinRoadClassRef.current;
        if (
          shouldLatchHighwayAfterSurface(
            prevRoad,
            instantRoad,
            drivingRejoinSurfaceAtRef.current,
            Date.now()
          )
        ) {
          drivingRejoinRoadClassRef.current = "highway";
        } else {
          drivingRejoinRoadClassRef.current = instantRoad;
          if (instantRoad === "city_streets") {
            drivingRejoinSurfaceAtRef.current = Date.now();
          }
        }
      }

      const routeBearing =
        totalM > 1
          ? initialBearingDegrees(
              pointAtAlongMeters(pollGeom, Math.min(alongForPoll, totalM)),
              pointAtAlongMeters(pollGeom, Math.min(alongForPoll + 52, totalM))
            )
          : bearingAlongRouteAhead(pos, pollGeom);

      let metersToStepEnd: number | null = null;
      if (lockedRoute?.turnSteps?.length && totalM > 0) {
        const bounds = turnStepAlongBounds(lockedRoute.turnSteps, totalM);
        const activeIdx = activeTurnStepIndexAlong(bounds.end, alongForPoll);
        metersToStepEnd = metersToCurrentStepEnd(bounds.end, activeIdx, alongForPoll);
      }
      const enterThresholdM = offRouteEnterThresholdM(metersToStepEnd);
      const driveAhead = isDriveAlwaysAheadView(viewModeRef.current);

      const rejoinCtx = lockedRoute?.geometry?.length
        ? resolveDrivingRejoinContext({
            guidanceRoute: lockedRoute,
            userAlongM: offRouteRejoinAlongMRef.current || alongForPoll,
            destLngLat: destLngLatRef.current,
            latchedRoadClass: drivingRejoinRoadClassRef.current,
          })
        : null;
      drivingRejoinModeRef.current = rejoinCtx?.mode ?? "manual";

      const result = runOffRoutePollTick({
        session: pollSessionRef.current,
        pos,
        guidanceGeometry: pollGeom,
        totalM,
        userAlongGuidanceM: alongForPoll,
        lockedGeometry: lockedRoute?.geometry,
        guidanceCumDist: guidanceCumDistRef.current,
        triggerCtx: driveAhead
          ? {
              headingDeg: headingRef.current,
              speedMps: speedMpsRef.current,
              routeBearingDeg: routeBearing,
              enterThresholdM: DRIVE_AHEAD_OFF_ROUTE_ENTER_M,
              minSpeedMps: DRIVE_AHEAD_MIN_SPEED_MPS,
              headingMinLateralM: DRIVE_AHEAD_HEADING_MIN_LATERAL_M,
              headingDeltaDeg: DRIVE_AHEAD_HEADING_DELTA_DEG,
            }
          : {
              headingDeg: headingRef.current,
              speedMps: speedMpsRef.current,
              routeBearingDeg: routeBearing,
              enterThresholdM,
            },
        navGoStartedAtMs: navGoStartedAtRef.current,
        useRecoveryLadder: driveAhead ? false : useRecoveryLadder,
        drivingRejoinMode: rejoinCtx?.mode ?? drivingRejoinModeRef.current,
        rejoinFailCount: offRouteRerouteFailStreakRef.current,
        driveAlwaysAhead: driveAhead,
        navStartGraceMs: driveAhead ? DRIVE_AHEAD_NAV_START_GRACE_MS : undefined,
        navStartGraceAlongM: driveAhead ? DRIVE_AHEAD_NAV_START_GRACE_ALONG_M : undefined,
        navStartGraceMaxLateralM: driveAhead ? DRIVE_AHEAD_NAV_START_GRACE_MAX_LATERAL_M : undefined,
        onPersonalFork: onPersonalForkRef?.current === true,
      });

      lastOffRouteSampleRef.current = {
        t: Date.now(),
        lateralM: result.sample.lateralM,
        alongM: result.sample.alongM,
      };

      if (result.rejoinedLockedRoute) {
        speakNavigationAlert("Back on your route.", settingVoiceGuidanceEnabled);
        setTapHint("Back on your route.");
        window.setTimeout(() => setTapHint(null), 4500);
      }

      applyPollSession(result.session);

      if (result.shouldPrefetchRejoinPreview && useRecoveryLadder) {
        void prefetchHoldRejoinPreview();
      } else if (!result.session.offRouteLatched) {
        clearHoldRejoinPreview();
      }

      if (result.shouldOfferRejoinChoices) {
        offerRejoinChoices(result.sample.lateralM, result.recoveryAction);
      }
    };

    tick();
    const id = window.setInterval(tick, OFF_ROUTE_POLL_MS);
    return () => window.clearInterval(id);
  }, [
    navigationStarted,
    guidanceRoute?.geometry,
    destLngLat,
    recalcRouteFromHere,
    settingVoiceGuidanceEnabled,
    resetOffRouteNavigation,
    syncPollSessionFromRefs,
    applyPollSession,
    lockedNavigationRouteIdRef,
    planRef,
    destLngLatRef,
    routingRef,
    altRoutesRefreshInFlightRef,
    userLngLatRef,
    guidanceRouteGeomRef,
    headingRef,
    speedMpsRef,
    navGoStartedAtRef,
    userAlongGuidanceMRef,
    setViewMode,
    setTapHint,
    effectiveAutoRerouteEnabled,
    executeAutoRecovery,
    viewModeRef,
    prefetchHoldRejoinPreview,
    clearHoldRejoinPreview,
    onPersonalForkRef,
  ]);

  const detourLockedRouteId = useMemo(() => {
    if (!navigationStarted) return null;
    return lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? null;
  }, [navigationStarted, orderedRouteIds, lockedNavigationRouteIdRef]);

  const detourRejoinDistanceLabel = useMemo(() => {
    if (
      !navigationStarted ||
      !autoRejoinGuidanceRouteId ||
      !effectiveUserLngLat ||
      !(detourRejoinAlongM > 0)
    ) {
      return null;
    }
    const lockedGeom = detourLockedRouteId
      ? plan.routes.find((r) => r.id === detourLockedRouteId)?.geometry
      : null;
    if (!lockedGeom?.length) return null;
    const remainingM = metersRemainingToRejoinOnLockedRoute(
      lockedGeom,
      detourRejoinAlongM,
      effectiveUserLngLat,
      userAlongGuidanceMRef.current
    );
    return formatDetourRejoinDistanceM(remainingM);
  }, [
    navigationStarted,
    autoRejoinGuidanceRouteId,
    effectiveUserLngLat,
    detourRejoinAlongM,
    detourLockedRouteId,
    plan.routes,
    userAlongGuidanceMRef,
  ]);

  const detourAutoActive = Boolean(navigationStarted && autoRejoinGuidanceRouteId);

  const showOffRouteStatusBanner =
    shouldShowManualOffRouteUi() &&
    navigationStarted &&
    (offRouteSevere || Boolean(autoRejoinGuidanceRouteId));

  const offRouteHoldPreviewActive = Boolean(
    navigationStarted &&
      holdRejoinPreviewActive &&
      offRouteLatched &&
      !autoRejoinGuidanceRouteId
  );

  return {
    offRouteSevere,
    offRouteLatched,
    offRouteRejoinAlongM,
    autoRejoinGuidanceRouteId,
    detourRejoinAlongM,
    offRouteAwaitingDriverChoice,
    offRouteHoldPreviewActive,
    holdRejoinPreviewRouteId,
    holdRejoinPreviewAlongM,
    recalcRouteFromHere,
    stayOnThisRoad,
    returnToOriginalRoute,
    resetOffRouteNavigation,
    clearDetourGuidance,
    showOffRouteStatusBanner,
    detourRejoinDistanceLabel,
    detourAutoActive,
    lastOffRouteSampleRef,
  };
}
