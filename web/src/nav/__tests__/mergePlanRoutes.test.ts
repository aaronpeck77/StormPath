import { describe, expect, it } from "vitest";
import {
  mergePlanPreservingPrimary,
  REJOIN_OVERLAY_ROUTE_ID,
  rejoinOverlaySlotIds,
} from "../mergePlanRoutes";
import type { NavRoute, TripPlan } from "../types";

function route(id: string, label: string): NavRoute {
  return {
    id,
    role: "balanced",
    label,
    geometry: [
      [-90.2, 38.6],
      [-90.1, 38.7],
    ],
    baseEtaMinutes: 10,
  };
}

describe("rejoinOverlaySlotIds", () => {
  it("uses existing B/C slots when present", () => {
    const plan: TripPlan = {
      originLabel: "A",
      destinationLabel: "B",
      routes: [route("r-a", "A"), route("r-b", "B")],
    };
    expect(rejoinOverlaySlotIds(plan, "r-a")).toEqual(["r-b"]);
  });

  it("invents a synthetic overlay id for single-route plans", () => {
    const plan: TripPlan = {
      originLabel: "A",
      destinationLabel: "B",
      routes: [route("r-a", "A")],
    };
    expect(rejoinOverlaySlotIds(plan, "r-a")).toEqual([REJOIN_OVERLAY_ROUTE_ID]);
  });
});

describe("mergePlanPreservingPrimary", () => {
  it("keeps locked geometry and replaces an existing alternate", () => {
    const locked = route("r-a", "A");
    const plan: TripPlan = {
      originLabel: "A",
      destinationLabel: "B",
      routes: [locked, route("r-b", "B")],
    };
    const stub = {
      ...route("r-b", "Rejoin"),
      geometry: [
        [-90.19, 38.61],
        [-90.15, 38.65],
      ] as [number, number][],
    };
    const next = mergePlanPreservingPrimary(plan, "r-a", [stub]);
    expect(next.routes.find((r) => r.id === "r-a")?.geometry).toEqual(locked.geometry);
    expect(next.routes.find((r) => r.id === "r-b")?.geometry).toEqual(stub.geometry);
  });

  it("appends a synthetic rejoin overlay onto a 1-route plan", () => {
    const locked = route("r-a", "A");
    const plan: TripPlan = {
      originLabel: "A",
      destinationLabel: "B",
      routes: [locked],
    };
    const stub = {
      ...route(REJOIN_OVERLAY_ROUTE_ID, "Rejoin"),
      geometry: [
        [-90.19, 38.61],
        [-90.15, 38.65],
      ] as [number, number][],
    };
    const next = mergePlanPreservingPrimary(plan, "r-a", [stub]);
    expect(next.routes).toHaveLength(2);
    expect(next.routes[0]?.id).toBe("r-a");
    expect(next.routes[0]?.geometry).toEqual(locked.geometry);
    expect(next.routes[1]?.id).toBe(REJOIN_OVERLAY_ROUTE_ID);
  });
});
