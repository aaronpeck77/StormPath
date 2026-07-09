import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { CompletedLearnedTrip } from "../frequentRoutes/types";
import { closestAlongRouteMeters, haversineMeters } from "../nav/routeGeometry";
import type { LngLat, NavRoute, TripPlan } from "../nav/types";
import {
  buildYourRouteNavRoute,
  buildYourRoutePreviewGeometry,
  detectForkFromActualVsPlanned,
  dismissPersonalFork,
  forkLooksLikeMainRoute,
  formatForkEtaDelta,
  isPersonalForkRouteId,
  loadPersonalForks,
  matchPersonalForkOffer,
  mergeDetectedFork,
  persistPersonalForks,
  PERSONAL_FORK_ROUTE_ID,
  shouldAutoCommitPersonalFork,
  type PersonalFork,
  type PersonalForkOffer,
} from "../personalForks";

export type UsePersonalForkNavOpts = {
  enabled: boolean;
  navigationStarted: boolean;
  viewMode: string;
  mainGeometry: LngLat[] | null;
  userLngLat: LngLat | null;
  userAlongMainM: number;
  destLngLat: LngLat | null;
  headingDeg: number | null;
  /** True once guidance is following the personal fork. */
  guidanceIsPersonalFork: boolean;
  /** Shared with off-route recovery so rejoin is suppressed while on the fork. */
  onPersonalForkRef: MutableRefObject<boolean>;
};

/**
 * Plus + learn-where-I-drive: match habitual forks during nav, offer "Your route",
 * and record forks when a completed drive diverges from the planned main.
 */
export function usePersonalForkNav(opts: UsePersonalForkNavOpts) {
  const [forks, setForks] = useState<PersonalFork[]>(() => loadPersonalForks());
  const [tripDismissedForkId, setTripDismissedForkId] = useState<string | null>(null);
  const [committedForkId, setCommittedForkId] = useState<string | null>(null);
  const autoCommitAttemptedRef = useRef<string | null>(null);

  const {
    enabled,
    navigationStarted,
    viewMode,
    mainGeometry,
    userLngLat,
    userAlongMainM,
    destLngLat,
    headingDeg,
    guidanceIsPersonalFork,
    onPersonalForkRef,
  } = opts;

  useEffect(() => {
    if (!navigationStarted) {
      setTripDismissedForkId(null);
      setCommittedForkId(null);
      autoCommitAttemptedRef.current = null;
    }
  }, [navigationStarted]);

  useEffect(() => {
    onPersonalForkRef.current = guidanceIsPersonalFork || committedForkId != null;
  }, [guidanceIsPersonalFork, committedForkId]);

  const offer: PersonalForkOffer | null = useMemo(() => {
    if (!enabled || !navigationStarted || !mainGeometry || !userLngLat) return null;
    if (viewMode !== "drive" && viewMode !== "topdown") return null;
    const matched = matchPersonalForkOffer({
      forks,
      mainGeometry,
      userLngLat,
      userAlongMainM,
      destLngLat,
    });
    if (!matched) return null;
    if (tripDismissedForkId && matched.fork.id === tripDismissedForkId) return null;
    return matched;
  }, [
    enabled,
    navigationStarted,
    viewMode,
    mainGeometry,
    userLngLat,
    userAlongMainM,
    destLngLat,
    forks,
    tripDismissedForkId,
  ]);

  const showChip = Boolean(
    offer &&
      !guidanceIsPersonalFork &&
      (offer.phase === "approaching" || offer.phase === "on_fork")
  );

  const showCommittedChip = Boolean(guidanceIsPersonalFork && offer);

  const previewGeometry = useMemo(() => {
    if (!offer || guidanceIsPersonalFork) return null;
    return buildYourRoutePreviewGeometry(offer.fork);
  }, [offer, guidanceIsPersonalFork]);

  const dismissForTrip = useCallback(() => {
    if (!offer) return;
    setTripDismissedForkId(offer.fork.id);
  }, [offer]);

  const dismissForever = useCallback(() => {
    if (!offer) return;
    setForks((prev) => {
      const next = dismissPersonalFork(prev, offer.fork.id);
      persistPersonalForks(next);
      return next;
    });
    setTripDismissedForkId(offer.fork.id);
  }, [offer]);

  const markCommitted = useCallback((forkId: string) => {
    setCommittedForkId(forkId);
    onPersonalForkRef.current = true;
    setForks((prev) => {
      const next = prev.map((f) =>
        f.id === forkId
          ? { ...f, takeCount: f.takeCount + 1, lastTakenMs: Date.now(), dismissed: false }
          : f
      );
      persistPersonalForks(next);
      return next;
    });
  }, []);

  const buildCommitRoute = useCallback(
    (fork: PersonalFork, main: LngLat[], alongM: number): NavRoute =>
      buildYourRouteNavRoute({ fork, mainGeometry: main, userAlongMainM: alongM }),
    []
  );

  const shouldAutoCommit = useMemo(() => {
    if (!offer || !userLngLat || !mainGeometry || guidanceIsPersonalFork) return false;
    if (autoCommitAttemptedRef.current === offer.fork.id) return false;
    return shouldAutoCommitPersonalFork({
      offer,
      userLngLat,
      mainGeometry,
      userAlongMainM,
      headingDeg,
    });
  }, [offer, userLngLat, mainGeometry, userAlongMainM, headingDeg, guidanceIsPersonalFork]);

  const noteAutoCommitAttempted = useCallback((forkId: string) => {
    autoCommitAttemptedRef.current = forkId;
  }, []);

  /** After a nav trip ends: learn forks from planned main vs actual GPS path. */
  const learnFromCompletedNav = useCallback(
    (plannedMain: LngLat[] | null, actualTrip: CompletedLearnedTrip | null) => {
      if (!enabled || !plannedMain || !actualTrip?.geometry?.length) return;
      if (plannedMain.length < 2) return;
      const detected = detectForkFromActualVsPlanned(plannedMain, actualTrip.geometry);
      if (!detected) return;
      if (forkLooksLikeMainRoute(detected.geometry, plannedMain)) return;
      setForks((prev) => {
        const next = mergeDetectedFork(prev, detected);
        persistPersonalForks(next);
        return next;
      });
    },
    [enabled]
  );

  /** Inject Your route into a plan when dest matches a strong fork (plan-time). */
  const injectYourRouteIntoPlan = useCallback(
    (plan: TripPlan, dest: LngLat | null): TripPlan => {
      if (!enabled || !dest || plan.routes.length < 1) return plan;
      if (plan.routes.some((r) => isPersonalForkRouteId(r.id))) return plan;
      const primary = plan.routes.find((r) => r.id === "r-a") ?? plan.routes[0]!;
      if (!primary.geometry || primary.geometry.length < 2) return plan;

      /* Plan-time: match by dest + fork on corridor — not the drive-ahead window. */
      let best: PersonalFork | null = null;
      for (const fork of forks) {
        if (fork.dismissed || fork.takeCount < 3 || fork.geometry.length < 2) continue;
        if (haversineMeters(fork.destCenter, dest) > 450 * 1.8) continue;
        const { alongMeters, lateralMetersApprox } = closestAlongRouteMeters(
          fork.forkPoint,
          primary.geometry
        );
        if (lateralMetersApprox > 280) continue;
        if (alongMeters > 25_000) continue;
        if (!best || fork.takeCount > best.takeCount) best = fork;
      }
      if (!best) return plan;

      const your = buildYourRouteNavRoute({
        fork: best,
        mainGeometry: primary.geometry,
        userAlongMainM: 0,
      });
      return { ...plan, routes: [...plan.routes, your] };
    },
    [enabled, forks]
  );

  const chipEtaLabel = offer ? formatForkEtaDelta(offer.fork.typicalEtaDeltaMin) : null;

  return {
    forks,
    offer,
    showChip,
    showCommittedChip,
    previewGeometry,
    onPersonalForkRef,
    dismissForTrip,
    dismissForever,
    markCommitted,
    buildCommitRoute,
    shouldAutoCommit,
    noteAutoCommitAttempted,
    learnFromCompletedNav,
    injectYourRouteIntoPlan,
    chipEtaLabel,
    PERSONAL_FORK_ROUTE_ID,
  };
}
