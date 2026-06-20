import { describe, expect, it } from "vitest";
import {
  createOffRoutePollSession,
  resetOffRoutePollSession,
  runOffRoutePollTick,
} from "../offRoutePollLogic";
import { OFF_ROUTE_CONFIRM_TICKS } from "../offRouteDetect";

const guidance: [number, number][] = [
  [-77.0, 38.9],
  [-77.01, 38.91],
  [-77.02, 38.92],
  [-77.03, 38.93],
];

const locked: [number, number][] = guidance;

describe("offRoutePollLogic", () => {
  it("creates a clean session", () => {
    const s = createOffRoutePollSession();
    expect(s.offRouteLatched).toBe(false);
    expect(s.offRouteSevere).toBe(false);
  });

  it("resets all latch and detour fields", () => {
    const dirty = {
      ...createOffRoutePollSession(),
      offRouteLatched: true,
      offRouteSevere: true,
      autoRejoinGuidanceRouteId: "r-b",
      detourRejoinAlongM: 1200,
    };
    const reset = resetOffRoutePollSession(dirty);
    expect(reset.offRouteLatched).toBe(false);
    expect(reset.autoRejoinGuidanceRouteId).toBeNull();
    expect(reset.detourRejoinAlongM).toBe(0);
  });

  it("latches off route after confirm streak while moving", () => {
    let session = createOffRoutePollSession();
    let offer = false;
    for (let i = 0; i < OFF_ROUTE_CONFIRM_TICKS + 2; i++) {
      const result = runOffRoutePollTick({
        session,
        pos: [-77.05, 38.85],
        guidanceGeometry: guidance,
        totalM: 4000,
        userAlongGuidanceM: 500,
        lockedGeometry: locked,
        triggerCtx: { speedMps: 12, headingDeg: 200, routeBearingDeg: 45 },
        navGoStartedAtMs: Date.now() - 120_000,
      });
      session = result.session;
      offer = offer || result.shouldOfferRejoinChoices;
    }
    expect(session.offRouteLatched).toBe(true);
    expect(session.offRouteSevere).toBe(true);
    expect(offer).toBe(true);
  });

  it("clears detour when rejoined onto locked route", () => {
    const session = {
      ...createOffRoutePollSession(),
      offRouteLatched: true,
      offRouteSevere: true,
      autoRejoinGuidanceRouteId: "r-b",
      detourRejoinAlongM: 2500,
    };
    const result = runOffRoutePollTick({
      session,
      pos: [-77.015, 38.915],
      guidanceGeometry: guidance,
      totalM: 4000,
      userAlongGuidanceM: 2400,
      lockedGeometry: locked,
      triggerCtx: { speedMps: 12 },
      navGoStartedAtMs: Date.now() - 120_000,
    });
    expect(result.rejoinedLockedRoute).toBe(true);
    expect(result.session.autoRejoinGuidanceRouteId).toBeNull();
    expect(result.session.offRouteSevere).toBe(false);
  });

  it("ignores off route while parked after Go grace", () => {
    const result = runOffRoutePollTick({
      session: createOffRoutePollSession(),
      pos: [-77.05, 38.915],
      guidanceGeometry: guidance,
      totalM: 4000,
      userAlongGuidanceM: 20,
      lockedGeometry: locked,
      triggerCtx: { speedMps: 0 },
      navGoStartedAtMs: Date.now() - 1000,
    });
    expect(result.session.offRouteLatched).toBe(false);
    expect(result.shouldOfferRejoinChoices).toBe(false);
  });
});
