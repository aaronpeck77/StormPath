import { useEffect } from "react";
import { useTripPlanStore } from "../state/tripPlanStore";
import type { ComputeRoutesFn } from "../nav/useComputeRoutes";
import type { LngLat } from "../nav/types";
import { postDockOrigin, readAppliedPlanId, readDockCode, readDockPlan, rememberAppliedPlanId } from "./grokDockClient";

/**
 * Quiet unless Info → Your assistant has a code. Never starts Go. Never speaks.
 */
export function useGrokDock(opts: {
  userLngLat: LngLat | null;
  navigationStarted: boolean;
  computeRoutes: ComputeRoutesFn;
  setTapHint: (msg: string | null) => void;
}): void {
  const { userLngLat, navigationStarted, computeRoutes, setTapHint } = opts;
  const setViaStops = useTripPlanStore((s) => s.setViaStops);

  useEffect(() => {
    const code = readDockCode();
    if (!code) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (userLngLat) {
        try {
          await postDockOrigin(code, userLngLat[0], userLngLat[1]);
        } catch {
          /* The next poll tries again. */
        }
      }
      if (navigationStarted) return;
      let plan = null;
      try {
        plan = await readDockPlan(code);
      } catch {
        return;
      }
      if (!plan || plan.id === readAppliedPlanId()) return;
      rememberAppliedPlanId(plan.id);
      if (plan.stop && plan.stopLabel) setViaStops([{ lngLat: plan.stop, label: plan.stopLabel }]);
      else setViaStops([]);
      await computeRoutes(plan.destination, plan.destinationLabel);
      setTapHint("Your assistant set this route. Hit Go when you are ready to leave.");
      window.setTimeout(() => setTapHint(null), 8000);
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [computeRoutes, navigationStarted, setTapHint, setViaStops, userLngLat]);
}
