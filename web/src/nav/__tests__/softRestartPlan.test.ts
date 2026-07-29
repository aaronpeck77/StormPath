import { describe, expect, it } from "vitest";
import { planAfterSoftRestartLock } from "../softRestartPlan";
import type { TripPlan } from "../types";

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
