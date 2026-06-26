import { describe, expect, it } from "vitest";
import {
  isAutoOffRouteRerouteActive,
  MANUAL_OFF_ROUTE_CHOICES_ENABLED,
  shouldShowManualOffRouteUi,
  shouldShowTrafficBypassUi,
  TRAFFIC_BYPASS_ENABLED,
} from "../constants";

describe("full auto navigation flags", () => {
  it("keeps manual bypass and off-route UI disabled", () => {
    expect(TRAFFIC_BYPASS_ENABLED).toBe(false);
    expect(MANUAL_OFF_ROUTE_CHOICES_ENABLED).toBe(false);
    expect(shouldShowTrafficBypassUi()).toBe(false);
    expect(shouldShowManualOffRouteUi()).toBe(false);
  });

  it("auto-reroutes off-route without the user setting when manual UI is off", () => {
    expect(isAutoOffRouteRerouteActive(false)).toBe(true);
    expect(isAutoOffRouteRerouteActive(true)).toBe(true);
  });
});
