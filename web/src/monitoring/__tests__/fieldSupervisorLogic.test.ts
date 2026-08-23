import { describe, expect, it } from "vitest";
import {
  SUPERVISOR_REPAIR_COOLDOWN_MS,
  canApplySupervisorRecovery,
  shouldReportSupervisorWatch,
  supervisorStuckMs,
} from "../fieldSupervisorLogic";
import { supervisorWatch } from "../supervisorWatchList";

describe("fieldSupervisorLogic", () => {
  it("allows the first recovery and blocks inside the cooldown", () => {
    expect(canApplySupervisorRecovery(null, 1_000)).toBe(true);
    expect(canApplySupervisorRecovery(1_000, 1_000 + SUPERVISOR_REPAIR_COOLDOWN_MS - 1)).toBe(
      false
    );
    expect(canApplySupervisorRecovery(1_000, 1_000 + SUPERVISOR_REPAIR_COOLDOWN_MS)).toBe(true);
  });

  it("uses the published hang windows for search and routing", () => {
    expect(supervisorWatch("search_hang").maxMs).toBe(12_000);
    expect(supervisorWatch("routing_hang").maxMs).toBe(20_000);
    expect(supervisorStuckMs(100, 12_100)).toBe(12_000);
  });

  it("reports search/routing always, and dead-zone holds only when they repeat", () => {
    expect(shouldReportSupervisorWatch("always_after_recovery", false)).toBe(true);
    expect(shouldReportSupervisorWatch("if_repeated", false)).toBe(false);
    expect(shouldReportSupervisorWatch("if_repeated", true)).toBe(true);
    expect(shouldReportSupervisorWatch("if_still_stuck", false)).toBe(false);
    expect(supervisorWatch("map_low_signal").recover).toBe("hold_last_good_map");
    expect(supervisorWatch("map_low_signal").maxMs).toBe(4_000);
  });
});
