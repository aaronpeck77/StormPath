import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import { collectMapboxRouteVariants } from "../services/mapboxDirectionsRouter";
import {
  getTollCompareContext,
  setTollCompareContext,
  type TrafficBypassCompareState,
} from "../state/routeCompareStore";
import {
  getViewModeBeforeTrafficBypass,
  setViewModeBeforeTrafficBypass,
} from "../state/uiStore";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { NormalizedWeatherAlert } from "../weatherAlerts/types";
import {
  buildRouteCompareFromPlan,
  type BuildRouteCompareFromPlanOpts,
} from "./buildRouteCompareFromPlan";
import { TRAFFIC_BYPASS_ENABLED } from "./constants";
import { polylineLengthMeters, pointAtAlongMeters } from "./routeGeometry";
import { viewModeAfterCompareCancel, defaultRouteCompareSelection } from "./routeCompareSelection";
import { pickTrafficBypassAnchorImpact, type TrafficBypassOffer } from "./trafficBypassOffer";
import { trafficBypassOfferHeadline, withTrafficBypassCompareKind } from "./trafficBypassFlow";
import type { RouteImpact } from "./routeImpacts";
import type { LngLat, NavRoute, TripPlan } from "./types";
import type { RouteAlert } from "./routeAlerts";

export type UseTrafficBypassFlowDeps = {
  isPlus: boolean;
  mapboxToken: string;
  learnEnabled: boolean;
  settingStormEnabled: boolean;
  tollBypassEnabled: boolean;
  navigationStarted: boolean;
  /** Dev-only `?demo=bypass` + Plus — enables mock compare without Mapbox. */
  demoBypassTrafficJamPlus: boolean;
  userLngLat: LngLat | null;
  effectiveUserLngLat: LngLat | null;
  destLngLat: LngLat | null;
  destinationLabel: string;
  guidanceRoute: NavRoute | null | undefined;
  guidanceRouteId: string;
  userAlongGuidanceM: number;
  driveEtaMinutes: number | null;
  plan: TripPlan;
  scored: ScoredRoute[];
  stormAlertsForRouting: NormalizedWeatherAlert[] | undefined;
  routeImpactsForUi: RouteImpact[];
  trafficBypassContext: TrafficBypassOffer | null;
  alternateBypassRouteId: string | null;
  routeHazardSheet: { routeId: string; alerts: RouteAlert[] } | null;
  trafficBypassCompareRef: MutableRefObject<TrafficBypassCompareState | null>;
  navigationStartedRef: MutableRefObject<boolean>;
  routeGraphEpochRef: MutableRefObject<number>;
  tollAcceptedRouteIdsRef: MutableRefObject<Set<string>>;
  pendingGoAfterTollRef: MutableRefObject<boolean>;
  setPlan: Dispatch<SetStateAction<TripPlan>>;
  setRouteSlotOrder: (ids: string[]) => void;
  setPreviewLegIndex: (i: number) => void;
  setViewMode: (mode: MapViewMode) => void;
  setFitTrigger: (updater: (n: number) => number) => void;
  setTapHint: (hint: string | null) => void;
  setTollRoutePrompt: (
    prompt:
      | { routeId: string; labels: string[] }
      | null
      | ((prev: { routeId: string; labels: string[] } | null) => {
          routeId: string;
          labels: string[];
        } | null)
  ) => void;
  setTollAvoidFailureNote: (note: string | null) => void;
  setTrafficBypassCompare: (
    state:
      | TrafficBypassCompareState
      | null
      | ((prev: TrafficBypassCompareState | null) => TrafficBypassCompareState | null)
  ) => void;
  setBypassBusy: (busy: boolean) => void;
  activateRouteCompare: (state: TrafficBypassCompareState) => void;
  handlePromoteRouteToPrimary: (id: string) => void;
  /** After traffic confirm while navigating — App copies promoted geom into locked guidance. */
  onTrafficConfirmWhileNavigating: (geometry: LngLat[]) => void;
  proceedGo: () => void;
  computeRoutes: (
    dest: LngLat,
    label: string,
    opts?: { preserveNavigation?: boolean }
  ) => Promise<unknown>;
  runAfterHazardSheetAction: (action: () => void) => void;
};

export function useTrafficBypassFlow(deps: UseTrafficBypassFlowDeps) {
  const {
    isPlus,
    mapboxToken,
    learnEnabled,
    settingStormEnabled,
    tollBypassEnabled,
    navigationStarted,
    demoBypassTrafficJamPlus,
    userLngLat,
    effectiveUserLngLat,
    destLngLat,
    destinationLabel,
    guidanceRoute,
    guidanceRouteId,
    userAlongGuidanceM,
    driveEtaMinutes,
    plan,
    scored,
    stormAlertsForRouting,
    routeImpactsForUi,
    trafficBypassContext,
    alternateBypassRouteId,
    routeHazardSheet,
    trafficBypassCompareRef,
    navigationStartedRef,
    routeGraphEpochRef,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
    setPlan,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setViewMode,
    setFitTrigger,
    setTapHint,
    setTollRoutePrompt,
    setTollAvoidFailureNote,
    setTrafficBypassCompare,
    setBypassBusy,
    activateRouteCompare,
    handlePromoteRouteToPrimary,
    onTrafficConfirmWhileNavigating,
    proceedGo,
    computeRoutes,
    runAfterHazardSheetAction,
  } = deps;

  const handleTrafficBypassCompareSelect = useCallback(
    (id: "r-a" | "r-b" | "r-c") => {
      setTrafficBypassCompare((prev) => (prev ? { ...prev, selectedLeg: id } : null));
      setFitTrigger((n) => n + 1);
    },
    [setTrafficBypassCompare, setFitTrigger]
  );

  const handleTrafficBypassCompareCancel = useCallback(() => {
    const tollCtx = getTollCompareContext();
    if (tollCtx) {
      setTollCompareContext(null);
      setTrafficBypassCompare(null);
      setPlan(tollCtx.originalPlan);
      setRouteSlotOrder(tollCtx.originalSlotOrder);
      setPreviewLegIndex(tollCtx.originalPreviewLegIndex);
      setViewModeBeforeTrafficBypass(null);
      setViewMode(viewModeAfterCompareCancel(tollCtx.originalViewMode, navigationStarted));
      setFitTrigger((n) => n + 1);
      const route = tollCtx.originalPlan.routes.find((r) => r.id === tollCtx.originalRouteId);
      if (
        tollBypassEnabled &&
        route?.hasTolls &&
        !tollAcceptedRouteIdsRef.current.has(tollCtx.originalRouteId)
      ) {
        setTollRoutePrompt({ routeId: tollCtx.originalRouteId, labels: route.tollLabels ?? [] });
      }
      return;
    }

    setTrafficBypassCompare(null);
    const restore = getViewModeBeforeTrafficBypass();
    setViewModeBeforeTrafficBypass(null);
    setViewMode(viewModeAfterCompareCancel(restore, navigationStarted));
    setFitTrigger((n) => n + 1);
  }, [
    tollBypassEnabled,
    navigationStarted,
    setTrafficBypassCompare,
    setPlan,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setViewMode,
    setTollRoutePrompt,
    setFitTrigger,
    tollAcceptedRouteIdsRef,
  ]);

  const handleTrafficBypassCompareConfirm = useCallback(() => {
    const tollCtx = getTollCompareContext();
    const prev = trafficBypassCompareRef.current;
    const id = prev?.selectedLeg;
    if (!id) return;

    if (tollCtx) {
      setTollCompareContext(null);
      setTrafficBypassCompare(null);
      setViewModeBeforeTrafficBypass(null);

      if (id === "r-b") {
        const p =
          tollCtx.fullTollFreePlan.routes.length > (isPlus ? 2 : 1)
            ? {
                ...tollCtx.fullTollFreePlan,
                routes: tollCtx.fullTollFreePlan.routes.slice(0, isPlus ? 2 : 1),
              }
            : tollCtx.fullTollFreePlan;
        setPlan(p);
        setRouteSlotOrder(p.routes.map((r) => r.id));
        setPreviewLegIndex(0);
        setTollAvoidFailureNote(null);
        setTollRoutePrompt(null);
        setTapHint("Updated to a toll-free route.");
        window.setTimeout(() => setTapHint(null), 5500);
        setViewMode("route");
      } else {
        setPlan(tollCtx.originalPlan);
        setRouteSlotOrder(tollCtx.originalSlotOrder);
        setPreviewLegIndex(tollCtx.originalPreviewLegIndex);
        tollAcceptedRouteIdsRef.current.add(tollCtx.originalRouteId);
        setTollRoutePrompt(null);
        if (tollCtx.pendingGo) {
          pendingGoAfterTollRef.current = false;
          proceedGo();
        } else {
          setViewMode(tollCtx.originalViewMode);
        }
      }
      setFitTrigger((n) => n + 1);
      return;
    }

    handlePromoteRouteToPrimary(id);
    const promoted = plan.routes.find((r) => r.id === id);
    if (promoted?.geometry?.length && navigationStartedRef.current) {
      onTrafficConfirmWhileNavigating(promoted.geometry.map(([a, b]) => [a, b] as LngLat));
    }
    setTrafficBypassCompare(null);
    setViewModeBeforeTrafficBypass(null);
    setViewMode("drive");
    setFitTrigger((n) => n + 1);
    setTapHint("Switched to your chosen route.");
    window.setTimeout(() => setTapHint(null), 5000);
  }, [
    handlePromoteRouteToPrimary,
    proceedGo,
    isPlus,
    setTrafficBypassCompare,
    setPlan,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setViewMode,
    setTollRoutePrompt,
    setTapHint,
    setTollAvoidFailureNote,
    setFitTrigger,
    plan.routes,
    trafficBypassCompareRef,
    navigationStartedRef,
    onTrafficConfirmWhileNavigating,
    tollAcceptedRouteIdsRef,
    pendingGoAfterTollRef,
  ]);

  const openRouteCompareFromPlan = useCallback(
    (opts: BuildRouteCompareFromPlanOpts) => {
      const state = buildRouteCompareFromPlan({
        opts,
        guidanceRoute,
        guidanceRouteId,
        plan,
        scored,
        driveEtaMinutes,
        navigationStarted,
      });
      if (!state) return false;
      activateRouteCompare(state);
      return true;
    },
    [
      guidanceRoute,
      guidanceRouteId,
      plan,
      scored,
      driveEtaMinutes,
      navigationStarted,
      activateRouteCompare,
    ]
  );

  const openRouteCompareFromHere = useCallback(
    async (opts?: {
      headline?: string;
      anchorAlongMeters?: number;
      anchorLngLat?: LngLat;
      confidence?: "low" | "medium" | "high";
    }) => {
      const originLngLat =
        demoBypassTrafficJamPlus && effectiveUserLngLat ? effectiveUserLngLat : userLngLat;
      if (!mapboxToken || !originLngLat || !destLngLat || !guidanceRoute?.geometry?.length) return;
      const epochAtStart = routeGraphEpochRef.current;
      setBypassBusy(true);
      const geom = guidanceRoute.geometry;
      const totalM = polylineLengthMeters(geom);
      const jamAlongM =
        opts?.anchorAlongMeters ??
        Math.min(totalM - 50, userAlongGuidanceM + Math.max(600, (totalM - userAlongGuidanceM) * 0.32));
      const hazardLngLat = opts?.anchorLngLat ?? pointAtAlongMeters(geom, jamAlongM);
      const compareHeadline = opts?.headline ?? "Routes from your location";

      try {
        const fresh = await collectMapboxRouteVariants(mapboxToken, originLngLat, destLngLat, {
          maxRoutes: isPlus ? 2 : 1,
          allowLocalTripThirdRoute: false,
          preferThreeRoutes: false,
          stormAlerts: stormAlertsForRouting,
          radarAvoidanceEnabled: isPlus && settingStormEnabled,
          trailRoutePersonalization: isPlus && learnEnabled,
        });

        if (fresh.length === 0 || epochAtStart !== routeGraphEpochRef.current) {
          const opened = openRouteCompareFromPlan({
            headline: compareHeadline,
            hazardLngLat,
            hazardAlongMeters: jamAlongM,
            confidence: opts?.confidence ?? "medium",
          });
          if (!opened) {
            setViewModeBeforeTrafficBypass(null);
            setTapHint("No alternate routes available right now — try again in a moment.");
            window.setTimeout(() => setTapHint(null), 6000);
          }
          return;
        }

        const byId = new Map(fresh.map((r) => [r.id, r]));
        setPlan((prev) => ({
          ...prev,
          routes: prev.routes.map((r) => byId.get(r.id) ?? r),
        }));

        const etaFor = (id: "r-a" | "r-b" | "r-c") => {
          const r = byId.get(id);
          return r?.geometry?.length && r.geometry.length >= 2
            ? Math.max(1, Math.round(r.baseEtaMinutes))
            : null;
        };
        const etaA = etaFor("r-a");
        if (etaA == null) {
          setViewModeBeforeTrafficBypass(null);
          setTapHint("Could not build route options — try again.");
          window.setTimeout(() => setTapHint(null), 5000);
          return;
        }

        activateRouteCompare(
          withTrafficBypassCompareKind({
            headline: compareHeadline,
            etaA,
            etaB: etaFor("r-b"),
            etaC: etaFor("r-c"),
            hasB: Boolean(byId.get("r-b")?.geometry && byId.get("r-b")!.geometry.length >= 2),
            hasC: Boolean(byId.get("r-c")?.geometry && byId.get("r-c")!.geometry.length >= 2),
            confidence: opts?.confidence ?? "medium",
            selectedLeg: defaultRouteCompareSelection(guidanceRouteId),
            hazardLngLat,
            hazardAlongMeters: jamAlongM,
          })
        );
      } catch {
        const opened = openRouteCompareFromPlan({
          headline: compareHeadline,
          hazardLngLat,
          hazardAlongMeters: jamAlongM,
          confidence: opts?.confidence ?? "medium",
        });
        if (!opened) {
          setViewModeBeforeTrafficBypass(null);
          setTapHint("Route compare failed — try again when you have a signal.");
          window.setTimeout(() => setTapHint(null), 5000);
        }
      } finally {
        setBypassBusy(false);
      }
    },
    [
      mapboxToken,
      userLngLat,
      effectiveUserLngLat,
      demoBypassTrafficJamPlus,
      destLngLat,
      guidanceRoute,
      userAlongGuidanceM,
      isPlus,
      stormAlertsForRouting,
      settingStormEnabled,
      learnEnabled,
      openRouteCompareFromPlan,
      activateRouteCompare,
      guidanceRouteId,
      setPlan,
      setTapHint,
      routeGraphEpochRef,
    ]
  );

  const handleTrafficBypassFromHere = useCallback(
    async (opts?: { anchorAlongMeters?: number; anchorLngLat?: LngLat }) => {
      if (!TRAFFIC_BYPASS_ENABLED) return;
      if (!isPlus) return;
      const anchorImpact =
        opts?.anchorAlongMeters == null ? pickTrafficBypassAnchorImpact(routeImpactsForUi) : null;
      await openRouteCompareFromHere({
        headline: trafficBypassOfferHeadline(trafficBypassContext),
        anchorAlongMeters: opts?.anchorAlongMeters ?? anchorImpact?.alongMeters,
        anchorLngLat: opts?.anchorLngLat ?? anchorImpact?.lngLat,
        confidence: trafficBypassContext?.confidence ?? "medium",
      });
    },
    [isPlus, routeImpactsForUi, trafficBypassContext, openRouteCompareFromHere]
  );

  const hazardSheetAlternateAvailable = useMemo(
    () =>
      TRAFFIC_BYPASS_ENABLED &&
      Boolean(
        isPlus && mapboxToken && userLngLat && destLngLat && guidanceRoute?.geometry?.length
      ),
    [isPlus, mapboxToken, userLngLat, destLngLat, guidanceRoute?.geometry?.length]
  );

  /** `?demo=bypass`: open A/B compare without Mapbox — uses current plan lines for map flags only. */
  const openDemoTrafficBypassCompareMock = useCallback(() => {
    if (!demoBypassTrafficJamPlus || !navigationStarted) return;
    if (trafficBypassCompareRef.current) return;
    const gr = guidanceRoute;
    if (!gr?.geometry?.length) return;
    const base = Math.max(8, Math.round(gr.baseEtaMinutes ?? 30));
    const totalM = polylineLengthMeters(gr.geometry);
    const userAlong = Number.isFinite(userAlongGuidanceM) ? userAlongGuidanceM : 0;
    const mockJamAlong = Math.min(
      totalM - 50,
      userAlong + Math.max(800, (totalM - userAlong) * 0.32)
    );
    activateRouteCompare(
      withTrafficBypassCompareKind({
        headline: "Demo: mock bypass compare (no network)",
        etaA: base,
        etaB: Math.max(6, base - 4),
        etaC: null,
        hasB: true,
        hasC: false,
        confidence: "medium",
        selectedLeg: defaultRouteCompareSelection(guidanceRouteId),
        hazardLngLat: pointAtAlongMeters(gr.geometry, mockJamAlong),
        hazardAlongMeters: mockJamAlong,
      })
    );
  }, [
    demoBypassTrafficJamPlus,
    navigationStarted,
    guidanceRoute,
    userAlongGuidanceM,
    guidanceRouteId,
    activateRouteCompare,
    trafficBypassCompareRef,
  ]);

  const handleHazardSheetTryAlternate = useCallback(() => {
    if (!routeHazardSheet) return;
    const primary = routeHazardSheet.alerts[0];
    runAfterHazardSheetAction(() => {
      if (!hazardSheetAlternateAvailable || !guidanceRoute?.geometry?.length || !destLngLat) {
        setTapHint("Route compare needs Plus, traffic, and an active trip.");
        window.setTimeout(() => setTapHint(null), 5500);
        return;
      }
      const geom = guidanceRoute.geometry;
      let anchorAlongM: number | undefined;
      let anchorLngLat: LngLat | undefined;
      if (primary?.alongMeters != null && geom.length) {
        const totalM = polylineLengthMeters(geom);
        anchorAlongM = Math.max(0, Math.min(primary.alongMeters, totalM - 1));
        anchorLngLat = pointAtAlongMeters(geom, anchorAlongM);
      }
      const bypassOpts = { anchorAlongMeters: anchorAlongM, anchorLngLat };
      if (primary?.corridorKind === "weather" && !alternateBypassRouteId) {
        void (async () => {
          await computeRoutes(destLngLat, destinationLabel.trim() || "Destination", {
            preserveNavigation: true,
          });
          void handleTrafficBypassFromHere(bypassOpts);
        })();
        return;
      }
      void handleTrafficBypassFromHere(bypassOpts);
    });
  }, [
    routeHazardSheet,
    runAfterHazardSheetAction,
    hazardSheetAlternateAvailable,
    guidanceRoute,
    destLngLat,
    destinationLabel,
    alternateBypassRouteId,
    computeRoutes,
    handleTrafficBypassFromHere,
    setTapHint,
  ]);

  return {
    handleTrafficBypassCompareSelect,
    handleTrafficBypassCompareCancel,
    handleTrafficBypassCompareConfirm,
    openRouteCompareFromPlan,
    openRouteCompareFromHere,
    handleTrafficBypassFromHere,
    openDemoTrafficBypassCompareMock,
    hazardSheetAlternateAvailable,
    handleHazardSheetTryAlternate,
  };
}
