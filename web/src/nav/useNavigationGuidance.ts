import { useMemo } from "react";
import { useTurnVoiceGuidance } from "../hooks/useTurnVoiceGuidance";
import { bannerPrimaryStepIndex } from "./bannerPrimaryStep";
import { useAlongRouteMetersHeldWhenOffLine } from "./guidanceAlongHold";
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
    speedMps,
  } = deps;

  const heldAlongM = useAlongRouteMetersHeldWhenOffLine(
    effectiveUserLngLat,
    routeGeometry ?? undefined,
    alongHoldResetKey
  );

  const userAlongGuidanceM =
    navigationStarted && navigationAlongM != null && Number.isFinite(navigationAlongM)
      ? navigationAlongM
      : heldAlongM;

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
