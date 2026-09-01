import { useMemo, useRef } from "react";
import { useTurnVoiceGuidance } from "../hooks/useTurnVoiceGuidance";
import { bannerPrimaryStepIndex } from "./bannerPrimaryStep";
import { useAlongRouteMetersHeldWhenOffLine } from "./guidanceAlongHold";
import { stabilizeAlongMeters } from "./navigationProgress";
import { activeTurnStepIndexAlong, turnStepAlongBounds } from "./turnStepAlong";
import type { LngLat, RouteTurnStep } from "./types";

export interface UseNavigationGuidanceDeps {
  navigationStarted: boolean;
  settingVoiceGuidanceEnabled: boolean;
  guidanceRouteId: string;
  guidanceRouteLengthM: number;
  turnSteps: RouteTurnStep[];
  effectiveUserLngLat: LngLat | null;
  routeGeometry: LngLat[] | null | undefined;
  alongHoldResetKey: number;
  /** When set (unified nav position pipeline), skips internal along-route projection. */
  navigationAlongM?: number;
  /** Freeze turn banner at this along-route distance while off-route / at a stop. */
  frozenAlongM?: number | null;
  speedMps?: number | null;
}

/** Turn banner indices, along-route progress, and voice prompts while navigating. */
export function useNavigationGuidance(deps: UseNavigationGuidanceDeps) {
  const {
    navigationStarted,
    settingVoiceGuidanceEnabled,
    guidanceRouteId,
    guidanceRouteLengthM,
    turnSteps,
    effectiveUserLngLat,
    routeGeometry,
    alongHoldResetKey,
    navigationAlongM,
    frozenAlongM,
    speedMps,
  } = deps;

  const heldAlongM = useAlongRouteMetersHeldWhenOffLine(
    effectiveUserLngLat,
    routeGeometry ?? undefined,
    alongHoldResetKey
  );

  const alongStabRef = useRef({ along: 0, t: 0, reset: -1 });
  if (alongStabRef.current.reset !== alongHoldResetKey) {
    alongStabRef.current = { along: 0, t: 0, reset: alongHoldResetKey };
  }

  const rawAlongM =
    navigationStarted && frozenAlongM != null && Number.isFinite(frozenAlongM)
      ? frozenAlongM
      : navigationStarted && navigationAlongM != null && Number.isFinite(navigationAlongM)
        ? navigationAlongM
        : heldAlongM;

  let userAlongGuidanceM = rawAlongM;
  if (navigationStarted && Number.isFinite(rawAlongM)) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const prevT = alongStabRef.current.t;
    const dtS = prevT > 0 ? (now - prevT) / 1000 : 0.35;
    const prevAlong = prevT > 0 ? alongStabRef.current.along : rawAlongM;
    userAlongGuidanceM = stabilizeAlongMeters({
      prevAlongM: prevAlong,
      proposedAlongM: rawAlongM,
      speedMps: speedMps ?? null,
      dtS: dtS,
    });
    alongStabRef.current = { along: userAlongGuidanceM, t: now, reset: alongHoldResetKey };
  }

  const turnStepBounds = useMemo(
    () => turnStepAlongBounds(turnSteps, guidanceRouteLengthM),
    [turnSteps, guidanceRouteLengthM]
  );

  const activeTurnIndex = useMemo(
    () => activeTurnStepIndexAlong(turnStepBounds.end, userAlongGuidanceM),
    [turnStepBounds.end, userAlongGuidanceM]
  );

  const bannerGuidance = useMemo(
    () =>
      bannerPrimaryStepIndex(turnSteps, activeTurnIndex, turnStepBounds.start, userAlongGuidanceM),
    [turnSteps, activeTurnIndex, turnStepBounds.start, userAlongGuidanceM]
  );

  const bannerTurnIndex = bannerGuidance.primaryIndex;
  const metersToBannerManeuver = bannerGuidance.metersToPrimaryManeuver;
  const bannerTurnInstruction = turnSteps[bannerTurnIndex]?.instruction ?? "";

  useTurnVoiceGuidance({
    enabled: settingVoiceGuidanceEnabled,
    navigating: navigationStarted,
    activeTurnIndex: bannerTurnIndex,
    instruction: bannerTurnInstruction,
    metersToManeuverEnd: metersToBannerManeuver,
    speedMps,
    routeLegId: guidanceRouteId,
  });

  return {
    userAlongGuidanceM,
    turnStepBounds,
    activeTurnIndex,
    bannerTurnIndex,
    metersToBannerManeuver,
    bannerTurnInstruction,
  };
}
