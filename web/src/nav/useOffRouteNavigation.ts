import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { buildMockTripBetween } from "./emptyTrip";
import {
  resolveDrivingRejoinContext,
  shouldLatchHighwayAfterSurface,
  type DrivingRejoinMode,
  type RoadNetworkClass,
} from "./drivingRejoinContext";
import { fetchLocalRejoinRoutes } from "./localRejoinRoutes";
import { mergePlanPreservingPrimary } from "./mergePlanRoutes";
import { speakNavigationAlert } from "./navigationVoiceAlert";
import {
  OFF_ROUTE_POLL_MS,
  measureOffRouteLateral,
  shouldOfferOffRouteRejoin,
} from "./offRouteDetect";
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
import { formatTripDestinationLabel, remainingViaStops, type TripStop } from "./routeWaypoints";
import { reconcileSlotOrderWithPlan } from "./routeSlotOrder";
import type { LngLat, NavRoute, TripPlan } from "./types";
import type { MapViewMode } from "../ui/driveMapTypes";
import { buildTripFromMapbox } from "../services/mapboxDirectionsRouter";
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
  viewMode: MapViewMode;
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
}

export type RecalcRouteFromHereFn = (opts?: {
  silent?: boolean;
  shuffle?: boolean;
  autoFollow?: boolean;
}) => Promise<void>;

export function useOffRouteNavigation(deps: UseOffRouteNavigationDeps) {
  const {
    userLngLat,
    destLngLat,
    plan,
    orderedRouteIds,
    viaStops,
    activeViaIndex,
    destinationLabel,
    navigationStarted,
    guidanceRoute,
    guidanceRouteLengthM,
    guidanceRouteId,
    userAlongGuidanceMRef,
    viewMode,
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
    setDestLngLat,
    setRouteSlotOrder,
    setViewMode,
    setRouting,
    setRouteError,
    setTapHint,
    setFitTrigger,
  } = deps;

  const [offRouteSevere, setOffRouteSevere] = useState(false);
  const offRouteSevereRef = useRef(false);
  const offRouteRerouteFailStreakRef = useRef(0);
  const rejoinShufflePassRef = useRef(0);
  const offRouteRejoinAlongMRef = useRef(0);
  const [detourRejoinAlongM, setDetourRejoinAlongM] = useState(0);
  const detourRejoinAlongMRef = useRef(0);
  detourRejoinAlongMRef.current = detourRejoinAlongM;
  const [autoRejoinGuidanceRouteId, setAutoRejoinGuidanceRouteId] = useState<string | null>(null);
  const autoRejoinGuidanceRouteIdRef = useRef<string | null>(null);
  autoRejoinGuidanceRouteIdRef.current = autoRejoinGuidanceRouteId;
  const pollSessionRef = useRef<OffRoutePollSession>(createOffRoutePollSession());
  const lastOffRouteSampleRef = useRef<{ t: number; lateralM: number; alongM: number } | null>(null);
  const drivingRejoinRoadClassRef = useRef<RoadNetworkClass>("unknown");
  const drivingRejoinSurfaceAtRef = useRef<number | null>(null);
  const drivingRejoinModeRef = useRef<DrivingRejoinMode>("manual");
  const effectiveAutoRerouteRef = useRef(effectiveAutoRerouteEnabled);
  effectiveAutoRerouteRef.current = effectiveAutoRerouteEnabled;
  const guidanceRouteLengthMRef = useRef(guidanceRouteLengthM);
  guidanceRouteLengthMRef.current = guidanceRouteLengthM;
  const guidanceCumDistRef = useRef<Float64Array | null>(null);
  const guidanceGeomSigRef = useRef("");

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
    rejoinShufflePassRef.current = 0;
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
  }, []);

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
      if (opts?.shuffle) rejoinShufflePassRef.current += 1;
      const epochAtStart = routeGraphEpochRef.current;
      altRoutesFetchAbortRef.current?.abort();
      const altFetch = new AbortController();
      altRoutesFetchAbortRef.current = altFetch;
      altRoutesRefreshInFlightRef.current = true;
      setRouting(true);
      setRouteError(null);
      try {
        const lockedId =
          lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? null;
        const lockedGeom =
          (lockedId ? plan.routes.find((r) => r.id === lockedId)?.geometry : null) ??
          guidanceRouteGeomRef.current ??
          null;

        if (
          navigationStartedRef.current &&
          lockedId &&
          lockedGeom &&
          lockedGeom.length >= 2 &&
          mapboxToken
        ) {
          const lateralNow = lastOffRouteSampleRef.current?.lateralM ?? 0;
          const { routes: rejoinRoutes, rejoinAlongM } = await fetchLocalRejoinRoutes({
            accessToken: mapboxToken,
            userLngLat,
            lockedGeometry: lockedGeom,
            userAlongM: offRouteRejoinAlongMRef.current || userAlongGuidanceMRef.current,
            plan,
            primaryId: lockedId,
            shufflePass: rejoinShufflePassRef.current,
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
            const autoFollow =
              opts?.autoFollow ??
              (opts?.silent === true && effectiveAutoRerouteRef.current && Boolean(bestId));

            if (autoFollow && bestId) {
              setAutoRejoinGuidanceRouteId(bestId);
              autoRejoinGuidanceRouteIdRef.current = bestId;
              pollSessionRef.current = {
                ...pollSessionRef.current,
                autoRejoinGuidanceRouteId: bestId,
              };
              setViewMode("drive");
              speakNavigationAlert(
                "Detour to rejoin your route.",
                settingVoiceGuidanceEnabled
              );
              if (!opts?.silent) {
                setTapHint("Auto detour — follow to rejoin your locked route ahead.");
                window.setTimeout(() => setTapHint(null), 7000);
              }
            } else if (offRouteSevereRef.current && navigationStartedRef.current) {
              if (!opts?.silent) {
                setTapHint(
                  opts?.shuffle
                    ? "New detour options — tap B or C below, or open map view to compare."
                    : "Local detour options — tap B or C below to rejoin ahead."
                );
                window.setTimeout(() => setTapHint(null), 5500);
              }
            } else if (!opts?.silent) {
              setTapHint(
                opts?.shuffle
                  ? "New local rejoin paths — your full route stays until you pick B or C."
                  : "Local detour options to rejoin your route ahead."
              );
              window.setTimeout(() => setTapHint(null), 5500);
            }
            return;
          }

          offRouteRerouteFailStreakRef.current += 1;
          if (!opts?.silent) {
            setTapHint("Could not find a local rejoin — try Other detour again.");
            window.setTimeout(() => setTapHint(null), 6000);
          }
          return;
        }

        let p: TripPlan;
        let destForMap: LngLat = destLngLat;
        let rerouteSnapNotice: string | undefined;
        if (mapboxToken) {
          const remainingVias = remainingViaStops(viaStops, activeViaIndex);
          const viaCoords = remainingVias.map((s) => s.lngLat);
          const snapFromGps = !isPlus;
          const built = await buildTripFromMapbox(
            mapboxToken,
            userLngLat,
            destLngLat,
            {
              origin: "Your location",
              destination: formatTripDestinationLabel(
                remainingVias,
                destinationLabel.trim() || "Destination"
              ),
            },
            {
              signal: altFetch.signal,
              via: viaCoords.length > 0 ? viaCoords : undefined,
              allowLocalTripThirdRoute: isPlus,
              preferThreeRoutes: isPlus,
              stormAlerts: stormAlertsForRouting,
              radarAvoidanceEnabled: isPlus && settingStormEnabled,
              trailRoutePersonalization: isPlus && learnEnabled,
              singleRouteFromPosition: snapFromGps,
              rejoinShufflePass: rejoinShufflePassRef.current,
            }
          );
          p = built.plan;
          destForMap = built.routeDestination;
          rerouteSnapNotice = built.snapNotice;
        } else {
          p = buildMockTripBetween(userLngLat, destLngLat, destinationLabel.trim() || "Destination");
        }
        p = !isPlus && p.routes.length > 2 ? { ...p, routes: p.routes.slice(0, 2) } : p;
        if (epochAtStart !== routeGraphEpochRef.current) return;
        const primaryId = lockedId ?? p.routes[0]?.id ?? null;
        if (primaryId && navigationStartedRef.current) {
          setPlan((prev) => mergePlanPreservingPrimary(prev, primaryId, p.routes));
        } else {
          setPlan(p);
          lockedNavigationRouteIdRef.current =
            p.routes[0]?.id ?? lockedNavigationRouteIdRef.current;
        }
        setDestLngLat(destForMap);
        const planIds = p.routes.map((r) => r.id);
        setRouteSlotOrder((prev) => reconcileSlotOrderWithPlan(prev, planIds));
        setFitTrigger((n) => n + 1);
        offRouteRerouteFailStreakRef.current = 0;
        if (!opts?.silent) {
          if (rerouteSnapNotice) {
            setTapHint(rerouteSnapNotice);
            window.setTimeout(() => setTapHint(null), 8500);
          } else {
            setTapHint(
              opts?.shuffle
                ? "New rejoin options — your chosen route stays until you pick B or C."
                : "Rejoin options updated from your position."
            );
            window.setTimeout(() => setTapHint(null), 5500);
          }
        }
      } catch (e) {
        if (isAbortError(e)) return;
        const msg =
          routeFetchUserMessage(e) ?? (e instanceof Error ? e.message : String(e));
        setRouteError(msg);
        offRouteRerouteFailStreakRef.current += 1;
        if (offRouteRerouteFailStreakRef.current >= 2 && !opts?.silent) {
          setTapHint("Could not fetch rejoin options — try More options again.");
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
      viaStops,
      activeViaIndex,
      orderedRouteIds,
      plan,
      mapboxToken,
      destinationLabel,
      isOnline,
      isPlus,
      stormAlertsForRouting,
      settingStormEnabled,
      learnEnabled,
      settingVoiceGuidanceEnabled,
      lockedNavigationRouteIdRef,
      routeGraphEpochRef,
      altRoutesFetchAbortRef,
      altRoutesRefreshInFlightRef,
      navigationStartedRef,
      guidanceRouteGeomRef,
      speedMpsRef,
      setPlan,
      setDestLngLat,
      setRouteSlotOrder,
      setViewMode,
      setRouting,
      setRouteError,
      setTapHint,
      setFitTrigger,
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

    const offerRejoinChoices = (lateralM: number) => {
      const session = pollSessionRef.current;
      if (session.offRouteChoiceOffered) return;
      if (!shouldOfferOffRouteRejoin(lateralM, session.offRouteReofferBlockedUntil)) {
        return;
      }
      pollSessionRef.current = { ...session, offRouteChoiceOffered: true };

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

      const autoDetour = effectiveAutoRerouteRef.current;

      if (!routingRef.current && !altRoutesRefreshInFlightRef.current) {
        void recalcRouteFromHere({ silent: true, autoFollow: autoDetour });
      }

      if (autoDetour) {
        setViewMode("drive");
        speakNavigationAlert(
          "Off route. Finding a detour to rejoin ahead.",
          settingVoiceGuidanceEnabled
        );
        if (!routingRef.current) {
          setTapHint("Off route — auto detour to rejoin your locked route ahead.");
          window.setTimeout(() => setTapHint(null), 7000);
        }
      } else {
        setTapHint(
          ctx?.roadClass === "highway"
            ? "Off route — tap B or C below to rejoin ahead."
            : "Off route — tap B or C below, or Other detour for more paths."
        );
        window.setTimeout(() => setTapHint(null), 7000);
      }
    };

    const tick = () => {
      syncPollSessionFromRefs();
      const pos = userLngLatRef.current;
      const geom = guidanceRouteGeomRef.current;
      if (!pos || !geom?.length) return;

      const totalM =
        guidanceRouteLengthMRef.current > 0
          ? guidanceRouteLengthMRef.current
          : polylineLengthMeters(geom);

      const lockedRoute = planRef.current.routes.find(
        (r) => r.id === lockedNavigationRouteIdRef.current
      );

      if (lockedRoute?.geometry?.length) {
        const sampleAlong = measureOffRouteLateral(
          pos,
          geom,
          userAlongGuidanceMRef.current,
          guidanceCumDistRef.current
        );
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
              pointAtAlongMeters(geom, Math.min(userAlongGuidanceMRef.current, totalM)),
              pointAtAlongMeters(geom, Math.min(userAlongGuidanceMRef.current + 52, totalM))
            )
          : bearingAlongRouteAhead(pos, geom);

      const result = runOffRoutePollTick({
        session: pollSessionRef.current,
        pos,
        guidanceGeometry: geom,
        totalM,
        userAlongGuidanceM: userAlongGuidanceMRef.current,
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
    guidanceRouteLengthM,
    destLngLat,
    recalcRouteFromHere,
    mapboxToken,
    isOnline,
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
    setViewMode,
    setTapHint,
  ]);

  const handleFollowDetourRoute = useCallback(
    (id: string) => {
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
      setTapHint("Detour selected — follow to rejoin your route.");
      window.setTimeout(() => setTapHint(null), 4500);
    },
    [plan.routes, orderedRouteIds, lockedNavigationRouteIdRef, navigationStartedRef, setViewMode, setTapHint]
  );

  const showOffRouteManualBanner =
    navigationStarted && (offRouteSevere || Boolean(autoRejoinGuidanceRouteId));

  const detourLockedRouteId = useMemo(() => {
    if (!navigationStarted) return null;
    return lockedNavigationRouteIdRef.current ?? orderedRouteIds[0] ?? null;
  }, [navigationStarted, orderedRouteIds, lockedNavigationRouteIdRef]);

  const detourAltChoices = useMemo(() => {
    if (!detourLockedRouteId || !offRouteSevere || autoRejoinGuidanceRouteId) return [];
    return plan.routes
      .filter((r) => r.id !== detourLockedRouteId)
      .slice(0, 2)
      .map((r) => ({
        id: r.id,
        label: r.label.replace(/^Rejoin /, "") || r.label,
      }));
  }, [plan.routes, detourLockedRouteId, offRouteSevere, autoRejoinGuidanceRouteId]);

  const detourAutoActive = Boolean(navigationStarted && autoRejoinGuidanceRouteId);

  const offRouteRejoinCompareActive =
    offRouteSevere && navigationStarted && !autoRejoinGuidanceRouteId && viewMode === "topdown";

  return {
    offRouteSevere,
    autoRejoinGuidanceRouteId,
    detourRejoinAlongM,
    recalcRouteFromHere,
    resetOffRouteNavigation,
    clearDetourGuidance,
    handleFollowDetourRoute,
    showOffRouteManualBanner,
    detourAltChoices,
    detourAutoActive,
    offRouteRejoinCompareActive,
    lastOffRouteSampleRef,
  };
}
