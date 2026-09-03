import { useEffect, useMemo, useRef } from "react";
import { useTurnVoiceGuidance } from "../hooks/useTurnVoiceGuidance";
import { bannerPrimaryStepIndex } from "./bannerPrimaryStep";
import { useAlongRouteMetersHeldWhenOffLine } from "./guidanceAlongHold";
import {
  clearPersistedNavAlong,
  navAlongGeomSig,
  readPersistedNavAlong,
  writePersistedNavAlong,
} from "./navAlongPersist";
import { stabilizeAlongMeters } from "./navigationProgress";
import { nextAlongAfterResume } from "./resumeAlongSnap";
import { haversineMeters } from "./routeGeometry";
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
  const resumeSnapRef = useRef(false);
  const persistSigRef = useRef("");
  const geomSig = navAlongGeomSig(routeGeometry);

  if (alongStabRef.current.reset !== alongHoldResetKey) {
    alongStabRef.current = { along: 0, t: 0, reset: alongHoldResetKey };
  }

  if (geomSig && persistSigRef.current !== geomSig) {
    persistSigRef.current = geomSig;
    const persisted = readPersistedNavAlong(geomSig);
    if (persisted != null && persisted > 0 && alongStabRef.current.along <= 1) {
      alongStabRef.current = { ...alongStabRef.current, along: persisted, t: 0 };
    }
  }

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") resumeSnapRef.current = true;
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onVis);
    };
  }, []);

  useEffect(() => {
    if (!navigationStarted) clearPersistedNavAlong();
  }, [navigationStarted]);

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
    const prevAlong = alongStabRef.current.along;
    const unseeded = prevT === 0 && prevAlong <= 1;
    const dest = routeGeometry && routeGeometry.length >= 2
      ? routeGeometry[routeGeometry.length - 1]!
      : null;
    const gpsToDestM =
      dest && effectiveUserLngLat ? haversineMeters(effectiveUserLngLat, dest) : null;

    if (unseeded && rawAlongM <= 1) {
      userAlongGuidanceM = rawAlongM;
    } else {
      userAlongGuidanceM = nextAlongAfterResume({
        prevAlongM: prevAlong,
        proposedAlongM: rawAlongM,
        resumeSnap: resumeSnapRef.current,
        unseeded,
        routeLengthM: guidanceRouteLengthM,
        gpsToDestM,
        stabilize: ({ prevAlongM, proposedAlongM }) =>
          stabilizeAlongMeters({
            prevAlongM,
            proposedAlongM,
            speedMps: speedMps ?? null,
            dtS,
          }),
      });
      resumeSnapRef.current = false;
      alongStabRef.current = { along: userAlongGuidanceM, t: now, reset: alongHoldResetKey };
      if (geomSig && userAlongGuidanceM > 1) writePersistedNavAlong(geomSig, userAlongGuidanceM);
    }
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
