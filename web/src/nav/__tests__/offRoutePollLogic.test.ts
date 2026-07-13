import { describe, expect, it } from "vitest";
import {
  createOffRoutePollSession,
  resetOffRoutePollSession,
  runOffRoutePollTick,
} from "../offRoutePollLogic";
import { OFF_ROUTE_CONFIRM_TICKS } from "../offRouteDetect";
import { pointAtAlongMeters } from "../routeGeometry";
import type { LngLat } from "../types";

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
        useRecoveryLadder: false,
      });
      session = result.session;
      offer = offer || result.shouldOfferRejoinChoices;
    }
    expect(session.offRouteLatched).toBe(true);
    expect(session.offRouteSevere).toBe(true);
    expect(offer).toBe(true);
  });

  it("holds recovery during slow pull-off before committing", () => {
    const now = 1_000_000;
    const alongM = 500;
    const anchor = pointAtAlongMeters(guidance, alongM);
    const pullOff: LngLat = [anchor[0]! + 0.00022, anchor[1]!];
    const session = {
      ...createOffRoutePollSession(),
      offRouteLatched: true,
      offRouteLatchedAtMs: now,
      offRouteRejoinAlongM: alongM,
      offRouteObservationPeakLateralM: 28,
      offRoutePriorLateralM: 30,
    };
    const held = runOffRoutePollTick({
      session,
      pos: pullOff,
      guidanceGeometry: guidance,
      totalM: 4000,
      userAlongGuidanceM: alongM,
      lockedGeometry: locked,
      triggerCtx: { speedMps: 0.4, headingDeg: 45, routeBearingDeg: 45 },
      navGoStartedAtMs: now - 120_000,
      nowMs: now + 3_000,
      useRecoveryLadder: true,
    });
    expect(held.shouldOfferRejoinChoices).toBe(false);
    expect(held.recoveryAction).toBeNull();
    expect(held.session.offRouteSevere).toBe(false);
    expect(held.shouldPrefetchRejoinPreview).toBe(true);
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

  it("ignores off route during early navigation grace even while moving", () => {
    const result = runOffRoutePollTick({
      session: createOffRoutePollSession(),
      pos: [-77.05, 38.915],
      guidanceGeometry: guidance,
      totalM: 4000,
      userAlongGuidanceM: 20,
      lockedGeometry: locked,
      triggerCtx: { speedMps: 12, headingDeg: 200, routeBearingDeg: 45 },
      navGoStartedAtMs: Date.now() - 1000,
    });
    expect(result.session.offRouteLatched).toBe(false);
    expect(result.shouldOfferRejoinChoices).toBe(false);
  });

  it("retries recovery after a failed attempt once cooldown elapses", () => {
    const now = 2_000_000;
    const alongM = 500;
    const session = {
      ...createOffRoutePollSession(),
      offRouteLatched: true,
      offRouteLatchedAtMs: now - 20_000,
      offRouteRejoinAlongM: alongM,
      offRouteObservationPeakLateralM: 40,
      offRoutePriorLateralM: 38,
      offRouteChoiceOffered: true,
      offRouteRecoveryLastFailMs: now - 16_000,
    };
    const result = runOffRoutePollTick({
      session,
      pos: [-77.05, 38.85],
      guidanceGeometry: guidance,
      totalM: 4000,
      userAlongGuidanceM: alongM,
      lockedGeometry: locked,
      triggerCtx: { speedMps: 12, headingDeg: 120, routeBearingDeg: 45 },
      navGoStartedAtMs: now - 120_000,
      nowMs: now,
      useRecoveryLadder: true,
      drivingRejoinMode: "auto_local",
    });
    expect(result.shouldOfferRejoinChoices).toBe(true);
    expect(result.recoveryAction).toMatch(/rejoin|replan/);
  });

  it("drive always ahead ignores small GPS wobble under the enter threshold", () => {
    const now = 2_000_000;
    const alongM = 500;
    const anchor = pointAtAlongMeters(guidance, alongM);
    /** ~5–8 m lateral — used to trip the old 2 m drive threshold. */
    const wobble: LngLat = [anchor[0]! + 0.00007, anchor[1]!];
    const result = runOffRoutePollTick({
      session: createOffRoutePollSession(),
      pos: wobble,
      guidanceGeometry: guidance,
      totalM: 4000,
      userAlongGuidanceM: alongM,
      lockedGeometry: locked,
      triggerCtx: {
        speedMps: 8,
        headingDeg: 45,
        routeBearingDeg: 45,
        enterThresholdM: 18,
        minSpeedMps: 1.5,
        headingMinLateralM: 12,
      },
      navGoStartedAtMs: now - 120_000,
      nowMs: now,
      driveAlwaysAhead: true,
    });
    expect(result.shouldOfferRejoinChoices).toBe(false);
    expect(result.recoveryAction).toBeNull();
    expect(result.session.offRouteLatched).toBe(false);
  });

  it("drive always ahead replans after sustained clear leave", () => {
    const now = 2_000_000;
    const alongM = 500;
    let session = createOffRoutePollSession();
    let last = runOffRoutePollTick({
      session,
      pos: [-77.05, 38.85],
      guidanceGeometry: guidance,
      totalM: 4000,
      userAlongGuidanceM: alongM,
      lockedGeometry: locked,
      triggerCtx: {
        speedMps: 8,
        headingDeg: 120,
        routeBearingDeg: 45,
        enterThresholdM: 18,
        minSpeedMps: 1.5,
        headingMinLateralM: 12,
      },
      navGoStartedAtMs: now - 120_000,
      nowMs: now,
      driveAlwaysAhead: true,
      confirmTicks: 3,
    });
    for (let i = 0; i < 4; i++) {
      last = runOffRoutePollTick({
        session: last.session,
        pos: [-77.05, 38.85],
        guidanceGeometry: guidance,
        totalM: 4000,
        userAlongGuidanceM: alongM,
        lockedGeometry: locked,
        triggerCtx: {
          speedMps: 8,
          headingDeg: 120,
          routeBearingDeg: 45,
          enterThresholdM: 18,
          minSpeedMps: 1.5,
          headingMinLateralM: 12,
        },
        navGoStartedAtMs: now - 120_000,
        nowMs: now + (i + 1) * 750,
        driveAlwaysAhead: true,
        confirmTicks: 3,
      });
      session = last.session;
      if (last.recoveryAction === "replan") break;
    }
    expect(last.shouldOfferRejoinChoices).toBe(true);
    expect(last.recoveryAction).toBe("replan");
    expect(session.offRouteLatched).toBe(true);
  });
});
