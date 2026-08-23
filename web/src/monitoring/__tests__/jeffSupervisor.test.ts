import { describe, expect, it } from "vitest";
import { isAllowedRecovery } from "../supervisorWatchList";
import { jeffSupervisorWatchId, resolveJeffSupervisorRecovery } from "../jeffSupervisor";

describe("jeffSupervisor", () => {
  it("maps Jeff domains onto supervisor watches", () => {
    expect(jeffSupervisorWatchId("drive_camera")).toBe("jeff_drive_camera");
    expect(jeffSupervisorWatchId("drive_puck")).toBe("jeff_drive_puck");
    expect(jeffSupervisorWatchId("live_traffic")).toBe("jeff_live_traffic");
  });

  it("holds last-good in a dead zone instead of yanking the camera or refreshing traffic", () => {
    expect(
      resolveJeffSupervisorRecovery({ holdLastGoodMap: true, domain: "drive_camera" })
    ).toBe("hold_last_good_map");
    expect(
      resolveJeffSupervisorRecovery({ holdLastGoodMap: true, domain: "drive_puck" })
    ).toBe("hold_last_good_map");
    expect(
      resolveJeffSupervisorRecovery({ holdLastGoodMap: true, domain: "live_traffic" })
    ).toBe("hold_last_good_map");
  });

  it("keeps Jeff's normal fixes when the link is healthy", () => {
    expect(
      resolveJeffSupervisorRecovery({ holdLastGoodMap: false, domain: "drive_camera" })
    ).toBe("resync_camera");
    expect(
      resolveJeffSupervisorRecovery({ holdLastGoodMap: false, domain: "drive_puck" })
    ).toBe("resync_camera");
    expect(
      resolveJeffSupervisorRecovery({ holdLastGoodMap: false, domain: "live_traffic" })
    ).toBe("refresh_traffic");
  });

  it("allows the hold override on Jeff watches", () => {
    expect(isAllowedRecovery("jeff_drive_camera", "resync_camera")).toBe(true);
    expect(isAllowedRecovery("jeff_drive_camera", "hold_last_good_map")).toBe(true);
    expect(isAllowedRecovery("jeff_live_traffic", "refresh_traffic")).toBe(true);
    expect(isAllowedRecovery("jeff_live_traffic", "hold_last_good_map")).toBe(true);
    expect(isAllowedRecovery("routing_hang", "hold_last_good_map")).toBe(false);
  });
});
