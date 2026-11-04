import { useEffect, useRef } from "react";
import { pickAdvisoryVoiceLine } from "../nav/advisoryVoice";
import type { DriveAheadLine } from "../nav/driveRouteAhead";
import { buildCarConditions, publishCarSession, type CarConditionsInput } from "../services/carSessionPublish";
import { getWebEnv } from "../config/env";
import { Capacitor } from "@capacitor/core";

type Params = {
  navigationStarted: boolean;
  destinationLabel: string | null;
  nextHazardAtEtaLine: string | null;
  driveRouteAheadLine: DriveAheadLine | null;
  nowcastLine: string | null;
  /** Optional turn banner line for CarPlay stub. */
  maneuverLine?: string | null;
  conditions: CarConditionsInput;
  puckColor: string;
  /** Sourced posted limit (horizon / Mapbox maxspeed) or null. Never an estimate. */
  speedLimitMph: number | null;
};

/** Keep UserDefaults trip snapshot fresh for CarPlay scaffolding. */
export function useCarSessionPublish(p: Params): void {
  const advisory = pickAdvisoryVoiceLine({
    nextHazardAtEtaLine: p.nextHazardAtEtaLine,
    driveRouteAheadLine: p.driveRouteAheadLine,
    nowcastLine: p.nowcastLine,
  });

  const latest = useRef({ p, advisory });
  useEffect(() => { latest.current = { p, advisory }; });
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const publish = () => {
      const { p: snapshot, advisory: line } = latest.current;
      void publishCarSession({
        navigating: snapshot.navigationStarted,
        destinationLabel: snapshot.destinationLabel,
        advisoryLine: line,
        maneuverLine: snapshot.maneuverLine ?? null,
        conditions: buildCarConditions(snapshot.conditions),
        radarTileBase: getWebEnv().rainViewerTileProxyUrl,
        puckColor: snapshot.puckColor,
        speedLimitMph: snapshot.speedLimitMph,
      });
    };
    publish();
    const timer = window.setInterval(publish, 15_000);
    return () => window.clearInterval(timer);
  }, [p.navigationStarted]);
}
