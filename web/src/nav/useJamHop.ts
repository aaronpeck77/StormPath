import { useMemo, useState } from "react";
import type { ComputeRoutesFn } from "./useComputeRoutes";
import { jamHopOffer, type JamHopOffer } from "./jamDrive";
import type { LngLat, RouteTurnStep } from "./types";

export function useJamHop(opts: {
  navigationStarted: boolean;
  line: LngLat[] | null | undefined;
  userAlongMeters: number;
  speedMps: number | null;
  congestion: (number | null)[] | null | undefined;
  steps: Pick<RouteTurnStep, "distanceM" | "maneuverType" | "exitNumber">[];
  destLngLat: LngLat | null;
  destinationLabel: string;
  computeRoutes: ComputeRoutesFn;
  onGo: () => void;
}): { offer: JamHopOffer | null; busy: boolean; dismiss: () => void; take: () => void } {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offer = useMemo(() => {
    if (!opts.navigationStarted) return null;
    return jamHopOffer({
      line: opts.line,
      userAlongMeters: opts.userAlongMeters,
      speedMps: opts.speedMps,
      congestion: opts.congestion,
      steps: opts.steps,
    });
  }, [opts.navigationStarted, opts.line, opts.userAlongMeters, opts.speedMps, opts.congestion, opts.steps]);

  const key = offer ? `${Math.round(offer.leaveByMeters)}:${Math.round(offer.rejoinMeters)}` : null;
  const visible = offer && key !== dismissedKey ? offer : null;

  return {
    offer: visible,
    busy,
    dismiss: () => {
      if (key) setDismissedKey(key);
    },
    take: () => {
      const current = visible;
      const dest = opts.destLngLat;
      if (!current?.canTakeNow || !dest || busy) return;
      setBusy(true);
      void opts
        .computeRoutes(dest, opts.destinationLabel, { jamExcludePoints: current.excludePoints })
        .then((result) => {
          if (result.ok) opts.onGo();
        })
        .finally(() => setBusy(false));
    },
  };
}
