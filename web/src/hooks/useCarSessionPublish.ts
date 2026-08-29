import { useEffect } from "react";
import { pickAdvisoryVoiceLine } from "../nav/advisoryVoice";
import type { DriveAheadLine } from "../nav/driveRouteAhead";
import { publishCarSession } from "../services/carSessionPublish";

type Params = {
  navigationStarted: boolean;
  destinationLabel: string | null;
  nextHazardAtEtaLine: string | null;
  driveRouteAheadLine: DriveAheadLine | null;
  nowcastLine: string | null;
  /** Optional turn banner line for CarPlay stub. */
  maneuverLine?: string | null;
};

/** Keep UserDefaults trip snapshot fresh for CarPlay scaffolding. */
export function useCarSessionPublish(p: Params): void {
  const advisory = pickAdvisoryVoiceLine({
    nextHazardAtEtaLine: p.nextHazardAtEtaLine,
    driveRouteAheadLine: p.driveRouteAheadLine,
    nowcastLine: p.nowcastLine,
  });

  useEffect(() => {
    void publishCarSession({
      navigating: p.navigationStarted,
      destinationLabel: p.destinationLabel,
      advisoryLine: advisory,
      maneuverLine: p.maneuverLine ?? null,
    });
  }, [
    p.navigationStarted,
    p.destinationLabel,
    advisory,
    p.maneuverLine,
  ]);
}
