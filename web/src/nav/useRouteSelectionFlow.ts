import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { LngLat, TripPlan } from "./types";
import { routingPreferenceForLockedRoute, type RoutingPreference } from "./routePreference";
import type { TripPlanState } from "../state/tripPlanStore";
import { usePersonalForkNav } from "../hooks/usePersonalForkNav";
import { isPersonalForkRouteId, PERSONAL_FORK_ROUTE_ID } from "../personalForks";
import { resolveNavigatingRouteSelect } from "./navigatingRouteSelect";
import { slotOrderAfterSelect } from "./routeSlotOrder";

/**
 * `useRouteSelectionFlow` — owns the "which leg is primary" cluster that was
 * inline in App.tsx: promoting a picked route while navigating, committing a
 * personal fork ("Your route"), the auto-commit effect, and preview-select
 * resolution (adopt / return-to-lock / preview-only).
 *
 * Shared refs and store setters stay App-owned (earlier hooks like
 * `useComputeRoutes`/`useOffRouteNavigation` also touch them) and are passed in.
 */
export function useRouteSelectionFlow(deps: {
  plan: TripPlan;
  planRouteIds: string[];
  orderedRouteIds: string[];
  navigationStarted: boolean;
  viewMode: MapViewMode;
  /* Shared mutable state owned by App. */
  navigationStartedRef: MutableRefObject<boolean>;
  lockedNavigationRouteIdRef: MutableRefObject<string | null>;
  routingPreferenceRef: MutableRefObject<RoutingPreference>;
  onPersonalForkRef: MutableRefObject<boolean>;
  navPlannedMainGeometryRef: MutableRefObject<LngLat[] | null>;
  /* Values derived earlier in App. */
  personalForkNav: ReturnType<typeof usePersonalForkNav>;
  personalForkMainGeometry: LngLat[] | null;
  guidanceGeometry: LngLat[] | undefined;
  userAlongGuidanceM: number;
  autoRejoinGuidanceRouteId: string | null;
  offRouteLatched: boolean;
  offRouteHoldPreviewActive: boolean;
  /* Store setters + local setters. */
  setPlan: TripPlanState["setPlan"];
  setRouteSlotOrder: TripPlanState["setRouteSlotOrder"];
  setPreviewLegIndex: TripPlanState["setPreviewLegIndex"];
  setViewMode: TripPlanState["setViewMode"];
  setTapHint: Dispatch<SetStateAction<string | null>>;
  setFitTrigger: Dispatch<SetStateAction<number>>;
  /* Navigation primitives owned by earlier App hooks. */
  adoptLockedRouteGeometry: (geometry: LngLat[], opts?: { force?: boolean }) => boolean;
  resetOffRouteNavigation: () => void;
  clearDetourGuidance: () => void;
  restartNative: () => void;
}): {
  handlePromoteRouteToPrimary: (id: string) => void;
  handlePreviewRouteSelect: (id: string) => void;
  commitPersonalFork: (forkId?: string) => void;
} {
  const {
    plan,
    planRouteIds,
    orderedRouteIds,
    navigationStarted,
    viewMode,
    navigationStartedRef,
    lockedNavigationRouteIdRef,
    routingPreferenceRef,
    onPersonalForkRef,
    navPlannedMainGeometryRef,
    personalForkNav,
    personalForkMainGeometry,
    guidanceGeometry,
    userAlongGuidanceM,
    autoRejoinGuidanceRouteId,
    offRouteLatched,
    offRouteHoldPreviewActive,
    setPlan,
    setRouteSlotOrder,
    setPreviewLegIndex,
    setViewMode,
    setTapHint,
    setFitTrigger,
    adoptLockedRouteGeometry,
    resetOffRouteNavigation,
    clearDetourGuidance,
    restartNative,
  } = deps;

  const handlePromoteRouteToPrimary = useCallback(
    (id: string) => {
      if (!plan.routes.some((r) => r.id === id)) return;
      setRouteSlotOrder((prev) => slotOrderAfterSelect(prev.length ? prev : planRouteIds, id));
      setPreviewLegIndex(0);
      if (navigationStartedRef.current) {
        lockedNavigationRouteIdRef.current = id;
        routingPreferenceRef.current = routingPreferenceForLockedRoute(
          plan.routes.find((r) => r.id === id)
        );
        onPersonalForkRef.current = isPersonalForkRouteId(id);
      }
      clearDetourGuidance();
    },
    [plan.routes, planRouteIds, clearDetourGuidance]
  );

  const commitPersonalFork = useCallback(
    (forkId?: string) => {
      const offer = personalForkNav.offer;
      if (!offer) return;
      if (forkId && offer.fork.id !== forkId) return;
      const main =
        navPlannedMainGeometryRef.current ??
        personalForkMainGeometry ??
        guidanceGeometry ??
        null;
      if (!main || main.length < 2) return;

      const your = personalForkNav.buildCommitRoute(offer.fork, main, userAlongGuidanceM);
      setPlan((prev) => {
        const without = prev.routes.filter((r) => !isPersonalForkRouteId(r.id));
        return { ...prev, routes: [...without, your] };
      });
      setRouteSlotOrder((prev) => {
        const cleaned = prev.filter((id) => !isPersonalForkRouteId(id));
        return slotOrderAfterSelect(cleaned.length ? cleaned : [your.id], your.id);
      });
      setPreviewLegIndex(0);
      lockedNavigationRouteIdRef.current = PERSONAL_FORK_ROUTE_ID;
      onPersonalForkRef.current = true;
      adoptLockedRouteGeometry(your.geometry, { force: true });
      personalForkNav.markCommitted(offer.fork.id);
      personalForkNav.noteAutoCommitAttempted(offer.fork.id);
      resetOffRouteNavigation();
      clearDetourGuidance();
      setViewMode("drive");
      setTapHint("Your route");
      window.setTimeout(() => setTapHint(null), 4000);
    },
    [
      personalForkNav,
      personalForkMainGeometry,
      guidanceGeometry,
      userAlongGuidanceM,
      adoptLockedRouteGeometry,
      resetOffRouteNavigation,
      clearDetourGuidance,
      setViewMode,
      setTapHint,
      setPlan,
      setRouteSlotOrder,
    ]
  );

  useEffect(() => {
    if (!personalForkNav.shouldAutoCommit || !personalForkNav.offer) return;
    personalForkNav.noteAutoCommitAttempted(personalForkNav.offer.fork.id);
    commitPersonalFork(personalForkNav.offer.fork.id);
  }, [personalForkNav.shouldAutoCommit, personalForkNav.offer, commitPersonalFork]);

  /**
   * Route / map view while navigating: picking a leg adopts it for Drive too.
   * Preview-only left Drive on the old lock (often behind the puck) with no line.
   */
  const handlePreviewRouteSelect = useCallback(
    (id: string) => {
      const picked = plan.routes.find((r) => r.id === id);
      if (!picked) return;

      const action = resolveNavigatingRouteSelect({
        navigationStarted,
        selectedId: id,
        lockedRouteId: lockedNavigationRouteIdRef.current,
        temporaryGuidanceRouteId: autoRejoinGuidanceRouteId,
        offRouteChoiceActive:
          offRouteLatched || offRouteHoldPreviewActive || Boolean(autoRejoinGuidanceRouteId),
      });

      if (action.type === "adopt") {
        handlePromoteRouteToPrimary(id);
        if (picked.geometry?.length >= 2) {
          adoptLockedRouteGeometry(
            picked.geometry.map(([a, b]) => [a, b] as LngLat),
            { force: true }
          );
        }
        resetOffRouteNavigation();
        setFitTrigger((n) => n + 1);
        setTapHint("Following this route.");
        window.setTimeout(() => setTapHint(null), 4000);
        /* Lock ref is already B. Restart after paint so Core gets B's corridor
         * and the no-interstate flag, not the A session it started on. */
        window.setTimeout(() => {
          void restartNative();
        }, 0);
        return;
      }

      if (action.type === "return_to_lock") {
        clearDetourGuidance();
        resetOffRouteNavigation();
        const i = orderedRouteIds.indexOf(action.lockedId);
        if (i >= 0) setPreviewLegIndex(i);
        setFitTrigger((n) => n + 1);
        setTapHint("Back on your original route.");
        window.setTimeout(() => setTapHint(null), 4000);
        return;
      }

      const i = orderedRouteIds.indexOf(id);
      if (i >= 0) setPreviewLegIndex(i);
      if (!navigationStarted || viewMode === "route" || viewMode === "topdown") {
        setFitTrigger((n) => n + 1);
      }
    },
    [
      plan.routes,
      orderedRouteIds,
      navigationStarted,
      viewMode,
      autoRejoinGuidanceRouteId,
      offRouteLatched,
      offRouteHoldPreviewActive,
      handlePromoteRouteToPrimary,
      adoptLockedRouteGeometry,
      resetOffRouteNavigation,
      clearDetourGuidance,
      restartNative,
    ]
  );

  return { handlePromoteRouteToPrimary, handlePreviewRouteSelect, commitPersonalFork };
}
