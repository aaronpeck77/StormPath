import { describe, expect, it } from "vitest";
import {
  assignOffRouteReplanSlots,
  planAfterOffRouteReplan,
  planAfterSoftRestartLock,
} from "../softRestartPlan";
import type { NavRoute, TripPlan } from "../types";

describe("planAfterSoftRestartLock", () => {
  it("replaces the locked leg and drops stale B/C / rejoin overlays", () => {
    const plan: TripPlan = {
      originLabel: "A",
      destinationLabel: "B",
      routes: [
        {
          id: "r-a",
          role: "fastest",
          label: "Main",
          geometry: [
            [-77, 38],
            [-77.1, 38],
          ],
          baseEtaMinutes: 40,
        },
        {
          id: "r-b",
          role: "balanced",
          label: "Detour",
          geometry: [
            [-77, 38.01],
            [-77.2, 38],
          ],
          baseEtaMinutes: 45,
        },
        {
          id: "r-rejoin",
          role: "fastest",
          label: "Rejoin",
          geometry: [
            [-77, 38.02],
            [-77.05, 38],
          ],
          baseEtaMinutes: 12,
        },
      ],
    };

    const next = planAfterSoftRestartLock(plan, "r-a", {
      geometry: [
        [-77.01, 38.01],
        [-76.5, 38.2],
      ],
      baseEtaMinutes: 33,
      label: "Main",
    });

    expect(next.routes).toHaveLength(1);
    expect(next.routes[0]?.id).toBe("r-a");
    expect(next.routes[0]?.baseEtaMinutes).toBe(33);
    expect(next.routes[0]?.geometry[0]).toEqual([-77.01, 38.01]);
  });
});

describe("planAfterOffRouteReplan", () => {
  it("forgets the old lock and installs fresh A + B", () => {
    const plan: TripPlan = {
      originLabel: "Home",
      destinationLabel: "Work",
      routes: [
        {
          id: "r-a",
          role: "fastest",
          label: "Main",
          geometry: [
            [-86.8, 36.1],
            [-86.7, 36.2],
          ],
          baseEtaMinutes: 40,
        },
      ],
    };
    const a: NavRoute = {
      id: "r-a",
      role: "fastest",
      label: "Main",
      geometry: [
        [-86.78, 36.16],
        [-86.6, 36.2],
      ],
      baseEtaMinutes: 22,
    };
    const b: NavRoute = {
      id: "r-b",
      role: "hazardSmart",
      label: "No interstate",
      geometry: [
        [-86.78, 36.16],
        [-86.75, 36.18],
        [-86.6, 36.2],
      ],
      baseEtaMinutes: 28,
    };
    const next = planAfterOffRouteReplan(plan, [a, b]);
    expect(next.routes).toHaveLength(2);
    expect(next.routes.map((r) => r.id)).toEqual(["r-a", "r-b"]);
    expect(next.routes[0]?.geometry[0]).toEqual([-86.78, 36.16]);
    expect(next.destinationLabel).toBe("Work");
  });
});

describe("assignOffRouteReplanSlots", () => {
  it("locks the forward route as A and keeps a distinct B", () => {
    const user: [number, number] = [-86.78, 36.16];
    const reverse: NavRoute = {
      id: "r-x",
      role: "fastest",
      label: "Back",
      geometry: [
        user,
        [-86.79, 36.15],
      ],
      baseEtaMinutes: 9,
      turnSteps: [{ instruction: "Make a U-turn", maneuverType: "continue", maneuverModifier: "uturn" }],
    };
    const forward: NavRoute = {
      id: "r-y",
      role: "fastest",
      label: "Ahead",
      geometry: [
        user,
        [-86.77, 36.17],
        [-86.6, 36.2],
      ],
      baseEtaMinutes: 20,
    };
    const alt: NavRoute = {
      id: "r-z",
      role: "hazardSmart",
      label: "No interstate",
      geometry: [
        user,
        [-86.76, 36.165],
        [-86.6, 36.2],
      ],
      baseEtaMinutes: 24,
    };
    const slots = assignOffRouteReplanSlots([reverse, forward, alt], user, 20);
    expect(slots[0]?.id).toBe("r-a");
    expect(slots[0]?.label).toBe("Main");
    expect(slots.some((r) => r.id === "r-b")).toBe(true);
    expect(slots[0]?.geometry[1]?.[1]).toBeGreaterThan(36.16);
  });
});
