import { useRouteCompareStore } from "../state/routeCompareStore";
import { useTripPlanStore } from "../state/tripPlanStore";
import { TRAFFIC_BYPASS_CONFIRM_LABEL_NAV } from "../nav/trafficBypassFlow";
import { TrafficBypassComparePanel } from "./TrafficBypassComparePanel";

interface Props {
  onSelect: (id: "r-a" | "r-b" | "r-c") => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * App-level wrapper around `TrafficBypassComparePanel` that subscribes to `routeCompareStore`
 * + `tripPlanStore` directly so the consumer (`App.tsx`) only forwards three handlers instead
 * of 14 individual fields off `trafficBypassCompare`. Replaced ~30 lines of inline JSX +
 * conditional gating with one component reference. Phase 4e1.
 *
 * **Behavior preserved exactly:**
 *  - Returns `null` when no compare is active (the prior `{trafficBypassCompare && (...)}` gate).
 *  - Toll-compare mode (`compareKind: "toll"`) substitutes the route labels ("With tolls" /
 *    "Toll-free"), forces `navigationStarted={false}` for the panel (the toll preview never
 *    runs during active drive), and shows the "Use this route" confirm label.
 *  - Traffic/hazard mode keeps the live route labels from `plan.routes` and uses the real
 *    `navigationStarted` flag.
 */
export function RouteCompareBottomPanel({ onSelect, onConfirm, onCancel }: Props) {
  const trafficBypassCompare = useRouteCompareStore((s) => s.trafficBypassCompare);
  const planRoutes = useTripPlanStore((s) => s.plan.routes);
  const navigationStarted = useTripPlanStore((s) => s.navigationStarted);

  if (!trafficBypassCompare) return null;

  const isTollCompare = trafficBypassCompare.compareKind === "toll";
  const routeLabels = isTollCompare
    ? { "r-a": "With tolls", "r-b": "Toll-free" }
    : {
        "r-a": planRoutes.find((r) => r.id === "r-a")?.label ?? "Route A",
        "r-b": planRoutes.find((r) => r.id === "r-b")?.label ?? "Route B",
        "r-c": planRoutes.find((r) => r.id === "r-c")?.label ?? "Route C",
      };

  return (
    <TrafficBypassComparePanel
      headline={trafficBypassCompare.headline}
      etaA={trafficBypassCompare.etaA}
      etaB={trafficBypassCompare.etaB}
      etaC={trafficBypassCompare.etaC}
      hasB={trafficBypassCompare.hasB}
      hasC={trafficBypassCompare.hasC}
      confidence={trafficBypassCompare.confidence}
      selectedLeg={trafficBypassCompare.selectedLeg}
      routeLabels={routeLabels}
      onSelect={onSelect}
      onConfirm={onConfirm}
      onCancel={onCancel}
      navigationStarted={isTollCompare ? false : navigationStarted}
      confirmLabel={
        isTollCompare ? "Use this route" : navigationStarted ? TRAFFIC_BYPASS_CONFIRM_LABEL_NAV : "Use this route"
      }
    />
  );
}
