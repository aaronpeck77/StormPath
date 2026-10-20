import { describe, expect, it } from "vitest";
import { assistantPlanApply } from "../grokPlanApply";

describe("assistant plan apply", () => {
  it("waits for Go before the drive starts", () => {
    expect(assistantPlanApply({ navigationStarted: false, planId: "p1", appliedPlanId: "" })).toBe("set-and-wait");
  });

  it("measures again and continues when a new plan arrives during the drive", () => {
    expect(assistantPlanApply({ navigationStarted: true, planId: "p2", appliedPlanId: "p1" })).toBe(
      "replan-and-resume"
    );
  });

  it("ignores a plan the phone already drew", () => {
    expect(assistantPlanApply({ navigationStarted: true, planId: "p1", appliedPlanId: "p1" })).toBe("skip");
    expect(assistantPlanApply({ navigationStarted: false, planId: null, appliedPlanId: "" })).toBe("skip");
  });
});
