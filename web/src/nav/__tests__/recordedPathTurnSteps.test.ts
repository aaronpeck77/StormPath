import { describe, expect, it } from "vitest";
import { buildTurnStepsFromRecordedGeometry } from "../recordedPathTurnSteps";
import { tripPlanFromSavedRoute } from "../planFromSavedRoute";
import type { SavedRoute } from "../savedRoutes";

describe("buildTurnStepsFromRecordedGeometry", () => {
  it("returns a follow step for a short trace", () => {
    const steps = buildTurnStepsFromRecordedGeometry([
      [-86.78, 36.16],
      [-86.79, 36.16],
    ]);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0]!.instruction).toMatch(/recorded path/i);
    expect(steps[steps.length - 1]!.instruction).toMatch(/arrive/i);
  });

  it("detects a right turn in a simple elbow", () => {
    const steps = buildTurnStepsFromRecordedGeometry([
      [-86.78, 36.16],
      [-86.77, 36.16],
      [-86.77, 36.17],
      [-86.77, 36.18],
    ]);
    expect(steps.some((s) => /turn/i.test(s.instruction))).toBe(true);
  });
});

describe("tripPlanFromSavedRoute", () => {
  const saved: SavedRoute = {
    id: "rec-1",
    name: "Camp trail",
    destinationLngLat: [-86.77, 36.18],
    destinationLabel: "Camp",
    geometry: [
      [-86.78, 36.16],
      [-86.77, 36.16],
      [-86.77, 36.18],
    ],
    createdAt: Date.now(),
  };

  it("builds turn steps for recorded paths without stored steps", () => {
    const plan = tripPlanFromSavedRoute(saved);
    expect(plan.routes[0]!.turnSteps?.length).toBeGreaterThan(0);
  });

  it("rebuilds turn steps when reversed", () => {
    const plan = tripPlanFromSavedRoute(saved, { reverse: true });
    expect(plan.routes[0]!.turnSteps?.length).toBeGreaterThan(0);
    expect(plan.routes[0]!.id).toContain("-rev");
  });
});
