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
import type { DrivingRejoinMode } from "./drivingRejoinContext";
import {
  classifyOffRouteRecovery,
  OFF_ROUTE_RECOVERY_RETRY_MS,
  type OffRouteRecoveryAction,
} from "./offRouteRecoveryPolicy";
import {
  DRIVE_AHEAD_CONFIRM_TICKS,
  DRIVE_AHEAD_OFF_ROUTE_EXIT_M,
} from "./driveAlwaysAhead";
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
  /** When off-route latch began (observation window). */
  offRouteLatchedAtMs: number;
  offRouteObservationPeakLateralM: number;
  offRoutePriorLateralM: number | null;
  offRouteRecoveryCommitted: boolean;
  /** Last failed auto-recovery — allows retry after cooldown. */
  offRouteRecoveryLastFailMs: number;
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
  /** Use wait → rejoin → replan ladder (full auto). Manual UI uses immediate offer. */
  useRecoveryLadder?: boolean;
  drivingRejoinMode?: DrivingRejoinMode;
  rejoinFailCount?: number;
  /** Drive view: immediate GPS replan — no hold/rejoin ladder. */
  driveAlwaysAhead?: boolean;
  confirmTicks?: number;
  navStartGraceMs?: number;
  navStartGraceAlongM?: number;
  navStartGraceMaxLateralM?: number;
};

export type OffRoutePollTickResult = {
  session: OffRoutePollSession;
  sample: OffRouteSample;
  shouldOfferRejoinChoices: boolean;
  /** Set when {@link useRecoveryLadder} commits to rejoin or replan. */
  recoveryAction: Exclude<OffRouteRecoveryAction, "hold"> | null;
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
    offRouteLatchedAtMs: 0,
    offRouteObservationPeakLateralM: 0,
    offRoutePriorLateralM: null,
    offRouteRecoveryCommitted: false,
    offRouteRecoveryLastFailMs: 0,
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
    offRouteLatchedAtMs: 0,
    offRouteObservationPeakLateralM: 0,
    offRoutePriorLateralM: null,
    offRouteRecoveryCommitted: false,
    offRouteRecoveryLastFailMs: 0,
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
  const useRecoveryLadder = input.useRecoveryLadder !== false;
  let recoveryAction: Exclude<OffRouteRecoveryAction, "hold"> | null = null;

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
      offRouteLatchedAtMs: 0,
      offRouteObservationPeakLateralM: 0,
      offRoutePriorLateralM: null,
      offRouteRecoveryCommitted: false,
      offRouteRecoveryLastFailMs: 0,
    };
    return {
      session,
      sample,
      shouldOfferRejoinChoices: false,
      recoveryAction: null,
      rejoinedLockedRoute: true,
      nearDestination: false,
    };
  }

  const goAt = input.navGoStartedAtMs;
  const graceMs = input.navStartGraceMs ?? OFF_ROUTE_NAV_START_GRACE_MS;
  const graceAlongM = input.navStartGraceAlongM ?? OFF_ROUTE_NAV_START_GRACE_ALONG_M;
  const graceMaxLat = input.navStartGraceMaxLateralM ?? OFF_ROUTE_NAV_START_GRACE_MAX_LATERAL_M;
  if (
    goAt != null &&
    nowMs - goAt < graceMs &&
    input.userAlongGuidanceM < graceAlongM &&
    lat < graceMaxLat
  ) {
    return {
      session,
      sample,
      shouldOfferRejoinChoices: false,
      recoveryAction: null,
      rejoinedLockedRoute: false,
      nearDestination: false,
    };
  }

  if (input.driveAlwaysAhead) {
    const nearDestination = input.totalM > 0 && alongM > input.totalM - 45;
    if (nearDestination) {
      session = resetOffRoutePollSession(session);
      return {
        session,
        sample,
        shouldOfferRejoinChoices: false,
        recoveryAction: null,
        rejoinedLockedRoute: false,
        nearDestination: true,
      };
    }

    const wouldTrigger = shouldTriggerOffRouteReroute(sample, input.triggerCtx);
    const confirmTicks = input.confirmTicks ?? DRIVE_AHEAD_CONFIRM_TICKS;
    session.offRouteConfirmStreak = wouldTrigger
      ? session.offRouteConfirmStreak + 1
      : 0;

    const exitM = DRIVE_AHEAD_OFF_ROUTE_EXIT_M;
    if (session.offRouteLatched && !wouldTrigger && lat < exitM) {
      session = resetOffRoutePollSession(session);
    } else if (
      wouldTrigger &&
      (session.offRouteConfirmStreak >= confirmTicks || session.offRouteLatched)
    ) {
      session.offRouteLatched = true;
      session.offRouteSevere = true;
      session.offRouteRejoinAlongM = alongM;
      return {
        session,
        sample,
        shouldOfferRejoinChoices: true,
        recoveryAction: "replan",
        rejoinedLockedRoute: false,
        nearDestination: false,
      };
    }

    session.offRoutePriorLateralM = lat;
    return {
      session,
      sample,
      shouldOfferRejoinChoices: false,
      recoveryAction: null,
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
      offRouteLatchedAtMs: 0,
      offRouteObservationPeakLateralM: 0,
      offRoutePriorLateralM: null,
      offRouteRecoveryCommitted: false,
      offRouteRecoveryLastFailMs: 0,
    };
    return {
      session,
      sample,
      shouldOfferRejoinChoices: false,
      recoveryAction: null,
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
        offRouteLatchedAtMs: 0,
        offRouteObservationPeakLateralM: 0,
        offRoutePriorLateralM: null,
        offRouteRecoveryCommitted: false,
      };
    } else {
      session.offRouteObservationPeakLateralM = Math.max(
        session.offRouteObservationPeakLateralM,
        lat
      );

      if (useRecoveryLadder && !session.offRouteRecoveryCommitted) {
        const retryReady =
          session.offRouteRecoveryLastFailMs <= 0 ||
          nowMs - session.offRouteRecoveryLastFailMs >= OFF_ROUTE_RECOVERY_RETRY_MS;
        const canAttemptRecovery =
          !session.offRouteChoiceOffered || retryReady;

        if (canAttemptRecovery) {
          const action = classifyOffRouteRecovery({
            nowMs,
            latchedAtMs: session.offRouteLatchedAtMs || nowMs,
            lateralM: lat,
            priorLateralM: session.offRoutePriorLateralM,
            lateralPeakM: session.offRouteObservationPeakLateralM,
            speedMps: input.triggerCtx.speedMps ?? 0,
            headingDeg: input.triggerCtx.headingDeg ?? null,
            routeBearingDeg: input.triggerCtx.routeBearingDeg ?? null,
            rejoinFailCount: input.rejoinFailCount ?? 0,
            drivingRejoinMode: input.drivingRejoinMode ?? "manual",
            recoveryCommitted: session.offRouteRecoveryCommitted,
          });

          if (action === "hold") {
            session.offRouteSevere = false;
          } else {
            session.offRouteSevere = true;
            if (session.offRouteChoiceOffered && retryReady) {
              session.offRouteChoiceOffered = false;
            }
            if (!session.offRouteChoiceOffered) {
              shouldOfferRejoinChoices = true;
              recoveryAction = action;
            }
          }
        } else {
          session.offRouteSevere = true;
        }
      } else {
        session.offRouteSevere = true;
      }
    }
  } else if (offRoute) {
    session.offRouteLatched = true;
    session.offRouteRejoinAlongM = alongM;
    session.offRouteLatchedAtMs = nowMs;
    session.offRouteObservationPeakLateralM = lat;
    session.offRoutePriorLateralM = null;
    session.offRouteRecoveryCommitted = false;

    if (!useRecoveryLadder) {
      session.offRouteSevere = true;
      shouldOfferRejoinChoices = true;
    }
  }

  session.offRoutePriorLateralM = lat;

  return {
    session,
    sample,
    shouldOfferRejoinChoices,
    recoveryAction,
    rejoinedLockedRoute: false,
    nearDestination: false,
  };
}
