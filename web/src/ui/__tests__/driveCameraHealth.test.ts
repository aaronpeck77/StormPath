import { describe, expect, it } from "vitest";
import {
  auditDriveCameraHeading,
  repairActionsForDriveCameraIssues,
} from "../driveCameraHealth";

describe("auditDriveCameraHeading", () => {
  it("passes when the applied camera bearing tracks course-over-ground", () => {
    const audit = auditDriveCameraHeading({
      travelBearingDeg: 90,
      appliedCameraBearingDeg: 95,
      speedMps: 15,
    });
    expect(audit.ok).toBe(true);
    expect(audit.issues).toHaveLength(0);
  });

  it("flags a sideways camera when applied bearing diverges from travel at real speed", () => {
    const audit = auditDriveCameraHeading({
      travelBearingDeg: 90,
      appliedCameraBearingDeg: 5,
      speedMps: 15,
    });
    expect(audit.ok).toBe(false);
    expect(audit.issues).toContain("camera_bearing_diverged_from_travel");
    expect(repairActionsForDriveCameraIssues(audit.issues)).toEqual(["resync_camera"]);
  });

  it("ignores disagreement while too slow for reliable course-over-ground", () => {
    const audit = auditDriveCameraHeading({
      travelBearingDeg: 90,
      appliedCameraBearingDeg: 5,
      speedMps: 1,
    });
    expect(audit.ok).toBe(true);
  });

  it("skips the check when travel bearing is unknown (no motion track yet)", () => {
    const audit = auditDriveCameraHeading({
      travelBearingDeg: null,
      appliedCameraBearingDeg: 5,
      speedMps: 15,
    });
    expect(audit.ok).toBe(true);
  });

  it("returns no repair actions when everything is fine", () => {
    expect(repairActionsForDriveCameraIssues([])).toEqual([]);
  });
});
