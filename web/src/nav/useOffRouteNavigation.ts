import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  formatDetourRejoinDistanceM,
  metersRemainingToRejoinOnLockedRoute,
} from "./detourRejoin";
import {
  resolveDrivingRejoinContext,
  shouldLatchHighwayAfterSurface,
  type DrivingRejoinMode,
  type RoadNetworkClass,
} from "./drivingRejoinContext";
import { fetchLocalRejoinRoutes } from "./localRejoinRoutes";
import { mergePlanPreservingPrimary } from "./mergePlanRoutes";
import { remainingViaStops } from "./routeWaypoints";
import { collectMapboxRouteVariants } from "../services/mapboxDirectionsRouter";
import { speakNavigationAlert } from "./navigationVoiceAlert";
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
  createOffRoutePollSession,
  resetOffRoutePollSession,
  runOffRoutePollTick,
  type OffRoutePollSession,
} from "./offRoutePollLogic";
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
  learnEnabled: boolean;
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
  adoptLockedRouteGeometry: (geometry: LngLat[]) => void;
}

export type RecalcRouteFromHereFn = (opts?: { silent?: boolean }) => Promise<void>;
export type StayOnThisRoadFn = () => Promise<void>;
export type ReturnToOriginalRouteFn = () => void;

/** Off-route detection — driver chooses stay on this road vs return to locked route. */
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
    learnEnabled,
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
    setViewMode,
    setRouting,
    setRouteError,
    setTapHint,
    setFitTrigger,
    adoptLockedRouteGeometry,
  } = deps;

  const [offRouteSevere, setOffRouteSevere] = useState(false);
  const [offRouteAwaitingDriverChoice, setOffRouteAwaitingDriverChoice] = useState(false);
  const offRouteSevereRef = useRef(false);
  const offRouteRerouteFailStreakRef = useRef(0);
  const offRouteRejoinAlongMRef = useRef(0);
  const [detourRejoinAlongM, setDetourRejoinAlongM] = useState(0);
  const detourRejoinAlongMRef = useRef(0);
  detourRejoinAlongMRef.current = detourRejoinAlongM;
  const [autoRejoinGuidanceRouteId, setAutoRejoinGuidanceRouteId] = useState<string | null>(null);
  const autoRejoinGuidanceRouteIdRef = useRef<string | null>(null);
  autoRejoinGuidanceRouteIdRef.current = autoRejoinGuidanceRouteId;
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

  const resetOffRouteNavigation = useCallback(() => {
    pollSessionRef.current = resetOffRoutePollSession(pollSessionRef.current);
    offRouteSevereRef.current = false;
    setOffRouteSevere(false);
    setOffRouteAwaitingDriverChoice(false);
    offRouteRejoinAlongMRef.current = 0;
    setDetourRejoinAlongM(0);
    detourRejoinAlongMRef.current = 0;
    setAutoRejoinGuidanceRouteId(null);
    autoRejoinGuidanceRouteIdRef.current = null;
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

  const followDetourRoute = useCallback(
    (id: string, voiceLine?: string) => {
      if (!plan.routes.some((r) => r.id === id)) return;
      const lockedId = lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? null;
      if (!navigationStartedRef.current || !lockedId || id === lockedId) return;
      setAutoRejoinGuidanceRouteId(id);
      autoRejoinGuidanceRouteIdRef.current = id;
      pollSessionRef.current = {
        ...pollSessionRef.current,
        autoRejoinGuidanceRouteId: id,
      };
      setViewMode("drive");
      if (voiceLine) {
        speakNavigationAlert(voiceLine, settingVoiceGuidanceEnabled);
      }
    },
    [
      plan.routes,
      orderedRouteIds,
      lockedNavigationRouteIdRef,
      navigationStartedRef,
      setViewMode,
      settingVoiceGuidanceEnabled,
    ]
  );

  const recalcRouteFromHere = useCallback<RecalcRouteFromHereFn>(
    async (opts) => {
      if (!userLngLat || !destLngLat) return;
      if (mapboxToken && !isOnline) {
        if (!opts?.silent) {
          setTapHint("Offline: route refresh unavailable.");
          window.setTimeout(() => setTapHint(null), 3500);
        }
        return;
      }
      const epochAtStart = routeGraphEpochRef.current;
      altRoutesFetchAbortRef.current?.abort();
      const altFetch = new AbortController();
      altRoutesFetchAbortRef.current = altFetch;
      altRoutesRefreshInFlightRef.current = true;
      setRouting(true);
      setRouteError(null);
      try {
        const lockedId = lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? null;
        const lockedGeom =
          (lockedId ? plan.routes.find((r) => r.id === lockedId)?.geometry : null) ??
          guidanceRouteGeomRef.current ??
          null;

        if (
          !navigationStartedRef.current ||
          !lockedId ||
          !lockedGeom ||
          lockedGeom.length < 2 ||
          !mapboxToken
        ) {
          return;
        }

        const lateralNow = lastOffRouteSampleRef.current?.lateralM ?? 0;
        const { routes: rejoinRoutes, rejoinAlongM } = await fetchLocalRejoinRoutes({
          accessToken: mapboxToken,
          userLngLat,
          lockedGeometry: lockedGeom,
          userAlongM: offRouteRejoinAlongMRef.current || userAlongGuidanceMRef.current,
          plan,
          primaryId: lockedId,
          shufflePass: 0,
          signal: altFetch.signal,
          isPlus,
          speedMps: speedMpsRef.current ?? undefined,
          lateralM: lateralNow > 0 ? lateralNow : undefined,
        });
        if (epochAtStart !== routeGraphEpochRef.current) return;
        if (rejoinRoutes.length > 0) {
          setPlan((prev) => mergePlanPreservingPrimary(prev, lockedId, rejoinRoutes));
          setFitTrigger((n) => n + 1);
          offRouteRerouteFailStreakRef.current = 0;
          detourRejoinAlongMRef.current = rejoinAlongM;
          setDetourRejoinAlongM(rejoinAlongM);
          pollSessionRef.current = {
            ...pollSessionRef.current,
            detourRejoinAlongM: rejoinAlongM,
          };
          const bestId = rejoinRoutes[0]?.id ?? null;
          if (bestId) {
            followDetourRoute(
              bestId,
              opts?.silent ? undefined : "Returning to your original route."
            );
            if (!opts?.silent) {
              setTapHint("Returning to your route.");
              window.setTimeout(() => setTapHint(null), 6000);
            }
          }
          return;
        }

        offRouteRerouteFailStreakRef.current += 1;
        if (!opts?.silent) {
          setTapHint("Could not return to your route — still following your chosen path.");
          window.setTimeout(() => setTapHint(null), 6000);
        }
      } catch (e) {
        if (isAbortError(e)) return;
        const msg = routeFetchUserMessage(e) ?? (e instanceof Error ? e.message : String(e));
        setRouteError(msg);
        offRouteRerouteFailStreakRef.current += 1;
        if (!opts?.silent) {
          setTapHint("Route recovery failed — still following your chosen path.");
          window.setTimeout(() => setTapHint(null), 6000);
        }
      } finally {
        setRouting(false);
        altRoutesRefreshInFlightRef.current = false;
      }
    },
    [
      userLngLat,
      destLngLat,
      orderedRouteIds,
      plan,
      mapboxToken,
      isOnline,
      isPlus,
      lockedNavigationRouteIdRef,
      routeGraphEpochRef,
      altRoutesFetchAbortRef,
      altRoutesRefreshInFlightRef,
      navigationStartedRef,
      guidanceRouteGeomRef,
      speedMpsRef,
      userAlongGuidanceMRef,
      setPlan,
      setRouting,
      setRouteError,
      setTapHint,
      setFitTrigger,
      followDetourRoute,
    ]
  );

  const stayOnThisRoad = useCallback<StayOnThisRoadFn>(async () => {
    if (!userLngLat || !destLngLat) return;
    if (mapboxToken && !isOnline) {
      setTapHint("Offline: can't update route from here.");
      window.setTimeout(() => setTapHint(null), 3500);
      return;
    }
    const lockedId = lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? null;
    if (!lockedId || !navigationStartedRef.current || !mapboxToken) return;

    altRoutesFetchAbortRef.current?.abort();
    const fetchCtrl = new AbortController();
    altRoutesFetchAbortRef.current = fetchCtrl;
    altRoutesRefreshInFlightRef.current = true;
    setRouting(true);
    setRouteError(null);
    clearDetourGuidance();
    setOffRouteAwaitingDriverChoice(false);

    const epochAtStart = routeGraphEpochRef.current;
    try {
      const remainingVias = remainingViaStops(viaStops, activeViaIndex);
      const viaCoords = remainingVias.map((s) => s.lngLat);
      const fresh = await collectMapboxRouteVariants(mapboxToken, userLngLat, destLngLat, {
        via: viaCoords.length > 0 ? viaCoords : undefined,
        singleRouteFromPosition: true,
        preferBackroads: learnEnabled,
        signal: fetchCtrl.signal,
        stormAlerts: stormAlertsForRouting,
        radarAvoidanceEnabled: isPlus && settingStormEnabled,
      });
      const leg = fresh[0];
      if (!leg?.geometry?.length || epochAtStart !== routeGraphEpochRef.current) return;

      setPlan((prev) => ({
        ...prev,
        routes: prev.routes.map((r) =>
          r.id === lockedId
            ? {
                ...r,
                geometry: leg.geometry,
                baseEtaMinutes: leg.baseEtaMinutes,
                turnSteps: leg.turnSteps,
                routeNotices: leg.routeNotices ?? r.routeNotices,
                routeNoticeAlongMeters: leg.routeNoticeAlongMeters ?? r.routeNoticeAlongMeters,
                mapboxIncidents: leg.mapboxIncidents ?? r.mapboxIncidents,
                hasTolls: leg.hasTolls ?? r.hasTolls,
                tollLabels: leg.tollLabels ?? r.tollLabels,
                postedSpeedSamples: leg.postedSpeedSamples ?? r.postedSpeedSamples,
              }
            : r
        ),
      }));
      adoptLockedRouteGeometry(leg.geometry.map(([a, b]) => [a, b] as LngLat));
      pollSessionRef.current = resetOffRoutePollSession(pollSessionRef.current);
      offRouteSevereRef.current = false;
      setOffRouteSevere(false);
      offRouteRerouteFailStreakRef.current = 0;
      setFitTrigger((n) => n + 1);
      setViewMode("drive");
      speakNavigationAlert("Following your chosen path.", settingVoiceGuidanceEnabled);
      setTapHint("Following your chosen path.");
      window.setTimeout(() => setTapHint(null), 5000);
    } catch (e) {
      if (isAbortError(e)) return;
      const msg = routeFetchUserMessage(e) ?? (e instanceof Error ? e.message : String(e));
      setRouteError(msg);
      setTapHint("Could not update route — try again.");
      window.setTimeout(() => setTapHint(null), 5000);
      setOffRouteAwaitingDriverChoice(true);
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
    learnEnabled,
    stormAlertsForRouting,
    isPlus,
    settingStormEnabled,
    lockedNavigationRouteIdRef,
    routeGraphEpochRef,
    altRoutesFetchAbortRef,
    altRoutesRefreshInFlightRef,
    navigationStartedRef,
    clearDetourGuidance,
    setPlan,
    adoptLockedRouteGeometry,
    setRouting,
    setRouteError,
    setTapHint,
    setFitTrigger,
    setViewMode,
    settingVoiceGuidanceEnabled,
  ]);

  const returnToOriginalRoute = useCallback<ReturnToOriginalRouteFn>(() => {
    setOffRouteAwaitingDriverChoice(false);
    void recalcRouteFromHere({ silent: false });
  }, [recalcRouteFromHere]);

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

    const offerRejoinChoices = (lateralM: number) => {
      const session = pollSessionRef.current;
      if (session.offRouteChoiceOffered) return;
      if (!shouldOfferOffRouteRejoin(lateralM, session.offRouteReofferBlockedUntil)) {
        return;
      }
      pollSessionRef.current = { ...session, offRouteChoiceOffered: true };

      if (isAutoOffRouteRerouteActive(effectiveAutoRerouteEnabled)) {
        const now = Date.now();
        if (
          routingRef.current ||
          altRoutesRefreshInFlightRef.current ||
          now - lastAutoRerouteAttemptRef.current < OFF_ROUTE_REROUTE_THROTTLE_MS
        ) {
          return;
        }
        lastAutoRerouteAttemptRef.current = now;
        if (MANUAL_OFF_ROUTE_CHOICES_ENABLED) {
          setTapHint("Off route — updating directions…");
          window.setTimeout(() => setTapHint(null), 5000);
        }
        void stayOnThisRoad();
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

      const result = runOffRoutePollTick({
        session: pollSessionRef.current,
        pos,
        guidanceGeometry: pollGeom,
        totalM,
        userAlongGuidanceM: alongForPoll,
        lockedGeometry: lockedRoute?.geometry,
        guidanceCumDist: guidanceCumDistRef.current,
        triggerCtx: {
          headingDeg: headingRef.current,
          speedMps: speedMpsRef.current,
          routeBearingDeg: routeBearing,
        },
        navGoStartedAtMs: navGoStartedAtRef.current,
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

      if (result.shouldOfferRejoinChoices) {
        offerRejoinChoices(result.sample.lateralM);
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
    stayOnThisRoad,
    routingRef,
    altRoutesRefreshInFlightRef,
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

  return {
    offRouteSevere,
    autoRejoinGuidanceRouteId,
    detourRejoinAlongM,
    offRouteAwaitingDriverChoice,
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
