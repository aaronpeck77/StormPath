import { describe, expect, it } from "vitest";
import { bannerPrimaryStepIndex } from "../bannerPrimaryStep";
import { activeTurnStepIndexAlong, turnStepAlongBounds } from "../turnStepAlong";
import type { RouteTurnStep } from "../types";

const steps: RouteTurnStep[] = [
  { instruction: "Head north", distanceM: 400 },
  { instruction: "Turn right on Main St", distanceM: 800 },
  { instruction: "Arrive", distanceM: 200 },
];

describe("useNavigationGuidance helpers", () => {
  it("picks the active turn from along-route progress", () => {
    const bounds = turnStepAlongBounds(steps, 1400);
    expect(activeTurnStepIndexAlong(bounds.end, 450)).toBe(1);
  });

  it("skips minor upcoming steps in the banner when still far away", () => {
    const bounds = turnStepAlongBounds(steps, 1400);
    const active = activeTurnStepIndexAlong(bounds.end, 50);
    const banner = bannerPrimaryStepIndex(steps, active, bounds.start, 50);
    expect(banner.primaryIndex).toBeGreaterThanOrEqual(0);
    expect(banner.metersToPrimaryManeuver).toBeGreaterThan(0);
  });
});
