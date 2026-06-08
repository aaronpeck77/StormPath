import { describe, expect, it } from "vitest";
import {
  computeRouteAxisMinWidth,
  routePlotLeftPct,
  routePlotWidthPct,
  ROUTE_AXIS_MAX_PX,
  ROUTE_AXIS_MIN_PX,
} from "../routeAxisLayout";

describe("routeAxisLayout", () => {
  it("maps route start and end to plot insets", () => {
    expect(routePlotLeftPct(0)).toBeCloseTo(8.5, 1);
    expect(routePlotLeftPct(1)).toBeCloseTo(91.5, 1);
  });

  it("computes band width on the shared plot axis", () => {
    expect(routePlotWidthPct(0.25, 0.5)).toBeCloseTo(20.75, 1);
  });

  it("keeps short trips at the panel baseline width", () => {
    expect(
      computeRouteAxisMinWidth({
        totalMeters: 40 * 1609.344,
        planEtaMinutes: 45,
        outlookStepCount: 5,
        bandCount: 1,
      })
    ).toBe(ROUTE_AXIS_MIN_PX);
  });

  it("widens the axis for long distance or multi-hour trips", () => {
    const longMiles = computeRouteAxisMinWidth({
      totalMeters: 320 * 1609.344,
      planEtaMinutes: 120,
      outlookStepCount: 5,
      bandCount: 2,
    });
    const longHours = computeRouteAxisMinWidth({
      totalMeters: 120 * 1609.344,
      planEtaMinutes: 540,
      outlookStepCount: 5,
      bandCount: 2,
    });
    expect(longMiles).toBeGreaterThan(ROUTE_AXIS_MIN_PX);
    expect(longHours).toBeGreaterThan(ROUTE_AXIS_MIN_PX);
    expect(longMiles).toBeLessThanOrEqual(ROUTE_AXIS_MAX_PX);
    expect(longHours).toBeLessThanOrEqual(ROUTE_AXIS_MAX_PX);
  });
});
