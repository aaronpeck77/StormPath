import { useEffect, useRef } from "react";
import { pickAdvisoryVoiceLine } from "../nav/advisoryVoice";
import type { DriveAheadLine } from "../nav/driveRouteAhead";
import { buildCarConditions, publishCarSession, type CarConditionsInput } from "../services/carSessionPublish";
import { timelineItemBandColor } from "../nav/timelineBandColors";
import { timelineItemShowsOnRouteGraph } from "../nav/routeAheadSync";
import { getWebEnv } from "../config/env";
import { Capacitor } from "@capacitor/core";

/** Same spans the phone paints on the drive line — road items caution+ plus
 * serious winter-weather warnings. CarPlay draws these as colored route
 * segments so the car screen shows the orange work-zone stretch too. */
const WINTER_SPAN_RX = /winter|ice|blizzard|snow|sleet|freez/i;

function carHazardSpansJson(items: CarConditionsInput["items"], totalMeters: number): string {
  const spans = items
    .filter(
      (item) =>
        timelineItemShowsOnRouteGraph(item) &&
        item.endMeters > 0 &&
        item.startMeters >= 0 &&
        item.endMeters <= totalMeters + 1 &&
        (item.track === "road" ||
          (item.track === "nws" &&
            WINTER_SPAN_RX.test(item.label) &&
            (item.severity === "serious" || item.severity === "avoid")))
    )
    .map((item) => ({
      s: Math.max(0, Math.round(item.startMeters)),
      e: Math.min(totalMeters, Math.round(item.endMeters)),
      c: timelineItemBandColor(item),
    }))
    .filter((sp) => sp.e > sp.s)
    .slice(0, 24);
  return JSON.stringify(spans);
}

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
        hazardSpansJson: carHazardSpansJson(
          snapshot.conditions.items,
          snapshot.conditions.totalMeters
        ),
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
