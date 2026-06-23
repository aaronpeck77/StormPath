import type { TrafficBypassCompareState } from "../state/routeCompareStore";
import type { TrafficBypassOffer } from "./trafficBypassOffer";

/**
 * Traffic bypass during navigation — explicit confirm only (nav v1).
 *
 * 1. **Detect** — localized jam/closure/incident ahead on the locked route (`computeTrafficBypassOffer`).
 * 2. **Offer** — bottom "Traffic bypass" chip + advisory bar CTA. Never auto-swaps guidance.
 * 3. **Compare** — driver taps → fresh A/B/C from GPS → Mp map + compare panel (`compareKind: "traffic"`).
 * 4. **Select** — tap A/B/C to preview on map; locked route unchanged until confirm.
 * 5. **Confirm** — "Switch to this route" promotes the leg (`driver_promote`) and updates locked geometry.
 * 6. **Resume** — return to Dr on the new locked route; off-route auto recovery unchanged.
 */
export type TrafficBypassFlowStep =
  | "detect"
  | "offer"
  | "compare"
  | "select"
  | "confirm"
  | "resume";

export function trafficBypassOfferHeadline(offer: TrafficBypassOffer | null | undefined): string {
  if (!offer) return "Compare routes from your location";
  const mi = offer.aheadMi;
  const ahead =
    mi >= 0.1 ? `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi ahead` : "ahead on your route";
  if (offer.category === "closure") return `Closure ${ahead} — compare routes`;
  if (offer.category === "incident" || offer.category === "construction") {
    return `${offer.headline} — compare routes`;
  }
  if (offer.delayMinutes >= 10) {
    return `Slowdown ${ahead} (+${Math.round(offer.delayMinutes)}m) — compare routes`;
  }
  return `${offer.headline} — compare routes`;
}

/** Panel + store defaults for drive-time traffic bypass compare. */
export function withTrafficBypassCompareKind(
  state: Omit<TrafficBypassCompareState, "compareKind">
): TrafficBypassCompareState {
  return { ...state, compareKind: "traffic" };
}

export const TRAFFIC_BYPASS_CONFIRM_LABEL_NAV = "Switch to this route";
