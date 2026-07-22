import { describe, expect, it } from "vitest";
import {
  auditLiveTrafficHealth,
  repairActionsForLiveTrafficIssues,
  LIVE_TRAFFIC_STALE_MS,
} from "../liveTrafficHealth";

describe("auditLiveTrafficHealth", () => {
  it("passes when a traffic leg has succeeded recently", () => {
    const audit = auditLiveTrafficHealth({
      navigationStarted: true,
      trafficEligible: true,
      hasEverSucceeded: true,
      msSinceLastSuccess: 30_000,
      speedMps: 12,
    });
    expect(audit.ok).toBe(true);
  });

  it("flags when eligible + driving but no leg has ever succeeded", () => {
    const audit = auditLiveTrafficHealth({
      navigationStarted: true,
      trafficEligible: true,
      hasEverSucceeded: false,
      msSinceLastSuccess: null,
      speedMps: 12,
    });
    expect(audit.ok).toBe(false);
    expect(audit.issues).toContain("traffic_overlay_missing_while_active");
    expect(repairActionsForLiveTrafficIssues(audit.issues)).toEqual(["refresh_traffic"]);
  });

  it("flags when the last success is older than the stale window", () => {
    const audit = auditLiveTrafficHealth({
      navigationStarted: true,
      trafficEligible: true,
      hasEverSucceeded: true,
      msSinceLastSuccess: LIVE_TRAFFIC_STALE_MS + 1,
      speedMps: 12,
    });
    expect(audit.ok).toBe(false);
  });

  it("does not flag while stopped (low speed) even if stale", () => {
    const audit = auditLiveTrafficHealth({
      navigationStarted: true,
      trafficEligible: true,
      hasEverSucceeded: true,
      msSinceLastSuccess: LIVE_TRAFFIC_STALE_MS + 1,
      speedMps: 0,
    });
    expect(audit.ok).toBe(true);
  });

  it("does not flag when traffic isn't eligible (Basic tier, offline, or setting off)", () => {
    const audit = auditLiveTrafficHealth({
      navigationStarted: true,
      trafficEligible: false,
      hasEverSucceeded: false,
      msSinceLastSuccess: null,
      speedMps: 12,
    });
    expect(audit.ok).toBe(true);
  });
});
