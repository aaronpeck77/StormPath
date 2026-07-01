import { describe, expect, it } from "vitest";
import {
  classifyOffRouteRecovery,
  isClearlyDivergingFromRoute,
  offRouteEnterThresholdM,
  OFF_ROUTE_ENTER_NEAR_STEP_M,
  OFF_ROUTE_ENTER_DEFAULT_M,
  OFF_ROUTE_OBSERVATION_AMBIGUOUS_MS,
  OFF_ROUTE_OBSERVATION_MAX_MS,
} from "../offRouteRecoveryPolicy";

describe("offRouteEnterThresholdM", () => {
  it("uses tighter threshold near an upcoming maneuver", () => {
    expect(offRouteEnterThresholdM(40)).toBe(OFF_ROUTE_ENTER_NEAR_STEP_M);
    expect(offRouteEnterThresholdM(200)).toBe(OFF_ROUTE_ENTER_DEFAULT_M);
  });
});

describe("classifyOffRouteRecovery", () => {
  const base = {
    nowMs: 100_000,
    latchedAtMs: 100_000,
    lateralM: 25,
    priorLateralM: 26,
    lateralPeakM: 28,
    speedMps: 0.5,
    headingDeg: 10,
    routeBearingDeg: 12,
    rejoinFailCount: 0,
    drivingRejoinMode: "manual" as const,
    recoveryCommitted: false,
  };

  it("holds indefinitely while fully stopped at a gas pump", () => {
    expect(
      classifyOffRouteRecovery({
        ...base,
        speedMps: 0.2,
        nowMs: base.latchedAtMs + OFF_ROUTE_OBSERVATION_MAX_MS + 5_000,
      })
    ).toBe("hold");
  });

  it("holds while lateral is shrinking during observation", () => {
    expect(
      classifyOffRouteRecovery({
        ...base,
        speedMps: 8,
        lateralM: 22,
        priorLateralM: 26,
        nowMs: base.latchedAtMs + 2_000,
      })
    ).toBe("hold");
  });

  it("holds briefly for ambiguous moving departures", () => {
    expect(
      classifyOffRouteRecovery({
        ...base,
        speedMps: 5,
        lateralM: 24,
        priorLateralM: 23,
        headingDeg: 20,
        routeBearingDeg: 15,
        nowMs: base.latchedAtMs + OFF_ROUTE_OBSERVATION_AMBIGUOUS_MS - 500,
      })
    ).toBe("hold");
  });

  it("prefers rejoin when beside the corridor after a missed turn", () => {
    expect(
      classifyOffRouteRecovery({
        ...base,
        speedMps: 9,
        drivingRejoinMode: "auto_local",
        nowMs: base.latchedAtMs + OFF_ROUTE_OBSERVATION_AMBIGUOUS_MS + 1,
        lateralM: 35,
        priorLateralM: 32,
        headingDeg: 120,
        routeBearingDeg: 0,
      })
    ).toBe("rejoin");
  });

  it("replans when clearly diverging on a highway-style leg", () => {
    expect(
      classifyOffRouteRecovery({
        ...base,
        speedMps: 14,
        lateralM: 130,
        priorLateralM: 125,
        lateralPeakM: 130,
        headingDeg: 120,
        routeBearingDeg: 0,
        nowMs: base.latchedAtMs + OFF_ROUTE_OBSERVATION_AMBIGUOUS_MS + 1,
      })
    ).toBe("replan");
  });

  it("replans after repeated rejoin failures", () => {
    expect(
      classifyOffRouteRecovery({
        ...base,
        speedMps: 8,
        drivingRejoinMode: "auto_local",
        rejoinFailCount: 2,
        nowMs: base.latchedAtMs + OFF_ROUTE_OBSERVATION_AMBIGUOUS_MS + 1,
      })
    ).toBe("replan");
  });
});

describe("isClearlyDivergingFromRoute", () => {
  it("detects strong heading mismatch while off the corridor", () => {
    expect(
      isClearlyDivergingFromRoute({
        lateralM: 30,
        priorLateralM: 18,
        speedMps: 10,
        headingDeg: 110,
        routeBearingDeg: 0,
        lateralPeakM: 30,
      })
    ).toBe(true);
  });

  it("does not flag parallel travel near the corridor", () => {
    expect(
      isClearlyDivergingFromRoute({
        lateralM: 20,
        priorLateralM: 19,
        speedMps: 10,
        headingDeg: 5,
        routeBearingDeg: 0,
        lateralPeakM: 20,
      })
    ).toBe(false);
  });
});
