import {
  OFF_ROUTE_CONFIRM_TICKS,
  OFF_ROUTE_NAV_START_GRACE_ALONG_M,
  OFF_ROUTE_NAV_START_GRACE_MAX_LATERAL_M,
  OFF_ROUTE_NAV_START_GRACE_MS,
  OFF_ROUTE_REOFFER_COOLDOWN_MS,
  measureOffRouteLateral,
  shouldExitOffRouteLatch,
  shouldOfferOffRouteRejoin,
  shouldTriggerOffRouteReroute,
  type OffRouteSample,
  type OffRouteTriggerContext,
} from "./offRouteDetect";
import { hasRejoinedLockedRoute } from "./detourRejoin";
import type { LngLat } from "./types";

export type OffRoutePollSession = {
  offRouteLatched: boolean;
  offRouteConfirmStreak: number;
  offRouteChoiceOffered: boolean;
  offRouteReofferBlockedUntil: number;
  offRouteSevere: boolean;
  offRouteRejoinAlongM: number;
  detourRejoinAlongM: number;
  autoRejoinGuidanceRouteId: string | null;
};

export type OffRoutePollTickInput = {
  session: OffRoutePollSession;
  pos: LngLat;
  guidanceGeometry: LngLat[];
  totalM: number;
  userAlongGuidanceM: number;
  lockedGeometry: LngLat[] | null | undefined;
  guidanceCumDist?: Float64Array | null;
  triggerCtx: OffRouteTriggerContext;
  navGoStartedAtMs: number | null;
  nowMs?: number;
};

export type OffRoutePollTickResult = {
  session: OffRoutePollSession;
  sample: OffRouteSample;
  shouldOfferRejoinChoices: boolean;
  rejoinedLockedRoute: boolean;
  nearDestination: boolean;
};

export function createOffRoutePollSession(): OffRoutePollSession {
  return {
    offRouteLatched: false,
    offRouteConfirmStreak: 0,
    offRouteChoiceOffered: false,
    offRouteReofferBlockedUntil: 0,
    offRouteSevere: false,
    offRouteRejoinAlongM: 0,
    detourRejoinAlongM: 0,
    autoRejoinGuidanceRouteId: null,
  };
}

export function resetOffRoutePollSession(session: OffRoutePollSession): OffRoutePollSession {
  return {
    ...session,
    offRouteLatched: false,
    offRouteConfirmStreak: 0,
    offRouteChoiceOffered: false,
    offRouteReofferBlockedUntil: 0,
    offRouteSevere: false,
    offRouteRejoinAlongM: 0,
    detourRejoinAlongM: 0,
    autoRejoinGuidanceRouteId: null,
  };
}

/** Pure off-route poll step — testable without React timers. */
export function runOffRoutePollTick(input: OffRoutePollTickInput): OffRoutePollTickResult {
  const nowMs = input.nowMs ?? Date.now();
  let session = { ...input.session };
  const sample = measureOffRouteLateral(
    input.pos,
    input.guidanceGeometry,
    input.userAlongGuidanceM,
    input.guidanceCumDist
  );
  const lat = sample.lateralM;
  const alongM = sample.alongM;

  if (
    session.autoRejoinGuidanceRouteId &&
    input.lockedGeometry &&
    input.lockedGeometry.length >= 2 &&
    session.detourRejoinAlongM > 0 &&
    hasRejoinedLockedRoute(
      input.pos,
      input.lockedGeometry,
      session.detourRejoinAlongM,
      alongM
    )
  ) {
    session = {
      ...session,
      autoRejoinGuidanceRouteId: null,
      detourRejoinAlongM: 0,
      offRouteLatched: false,
      offRouteChoiceOffered: false,
      offRouteConfirmStreak: 0,
      offRouteReofferBlockedUntil: nowMs + OFF_ROUTE_REOFFER_COOLDOWN_MS,
      offRouteSevere: false,
    };
    return {
      session,
      sample,
      shouldOfferRejoinChoices: false,
      rejoinedLockedRoute: true,
      nearDestination: false,
    };
  }

  const goAt = input.navGoStartedAtMs;
  if (
    goAt != null &&
    nowMs - goAt < OFF_ROUTE_NAV_START_GRACE_MS &&
    input.userAlongGuidanceM < OFF_ROUTE_NAV_START_GRACE_ALONG_M &&
    lat < OFF_ROUTE_NAV_START_GRACE_MAX_LATERAL_M
  ) {
    return {
      session,
      sample,
      shouldOfferRejoinChoices: false,
      rejoinedLockedRoute: false,
      nearDestination: false,
    };
  }

  const wouldTrigger = shouldTriggerOffRouteReroute(sample, input.triggerCtx);
  session.offRouteConfirmStreak = wouldTrigger
    ? session.offRouteConfirmStreak + 1
    : 0;

  const offRoute =
    wouldTrigger &&
    session.offRouteConfirmStreak >= OFF_ROUTE_CONFIRM_TICKS &&
    shouldOfferOffRouteRejoin(lat, session.offRouteReofferBlockedUntil, nowMs);

  const nearDestination = input.totalM > 0 && alongM > input.totalM - 45;
  if (nearDestination) {
    session = {
      ...session,
      offRouteLatched: false,
      offRouteChoiceOffered: false,
      offRouteConfirmStreak: 0,
      offRouteSevere: false,
    };
    return {
      session,
      sample,
      shouldOfferRejoinChoices: false,
      rejoinedLockedRoute: false,
      nearDestination: true,
    };
  }

  let shouldOfferRejoinChoices = false;

  if (session.offRouteLatched) {
    if (session.autoRejoinGuidanceRouteId) {
      session.offRouteSevere = true;
    } else if (shouldExitOffRouteLatch(lat)) {
      session = {
        ...session,
        offRouteLatched: false,
        offRouteChoiceOffered: false,
        offRouteConfirmStreak: 0,
        offRouteReofferBlockedUntil: nowMs + OFF_ROUTE_REOFFER_COOLDOWN_MS,
        offRouteSevere: false,
        detourRejoinAlongM: 0,
      };
    } else {
      session.offRouteSevere = true;
    }
  } else if (offRoute) {
    session.offRouteLatched = true;
    session.offRouteRejoinAlongM = alongM;
    session.offRouteSevere = true;
    shouldOfferRejoinChoices = true;
  }

  return {
    session,
    sample,
    shouldOfferRejoinChoices,
    rejoinedLockedRoute: false,
    nearDestination: false,
  };
}
