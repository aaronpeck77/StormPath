import { describe, expect, it } from "vitest";
import {
  SUPERVISOR_PHONE_WATCH_IDS,
  SUPERVISOR_WATCHES,
  buildFieldReport,
  isAllowedRecovery,
  isFieldSupervisorReport,
  isSupervisorWatchId,
  sentryHealthMessage,
  supervisorWatch,
} from "../supervisorWatchList";

describe("supervisorWatchList", () => {
  it("has unique watch ids and a recovery for each", () => {
    const ids = SUPERVISOR_WATCHES.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of SUPERVISOR_WATCHES) {
      expect(w.maxMs).toBeGreaterThan(0);
      expect(w.recover).toBeTruthy();
    }
  });

  it("looks up a watch and allows only its recovery or report_only", () => {
    const routing = supervisorWatch("routing_hang");
    expect(routing.recover).toBe("abort_and_clear_busy");
    expect(isAllowedRecovery("routing_hang", "abort_and_clear_busy")).toBe(true);
    expect(isAllowedRecovery("routing_hang", "report_only")).toBe(true);
    expect(isAllowedRecovery("routing_hang", "end_nav_to_plan")).toBe(false);
  });

  it("polls map hold plus the other field stalls on the phone", () => {
    expect(SUPERVISOR_PHONE_WATCH_IDS).toEqual([
      "map_low_signal",
      "false_online",
      "jeff_drive_camera",
      "jeff_drive_puck",
      "jeff_live_traffic",
      "routing_hang",
      "search_hang",
      "bypass_hang",
      "traffic_overlay_stuck",
      "storm_alerts_hang",
    ]);
    expect(supervisorWatch("map_low_signal").recover).toBe("hold_last_good_map");
    expect(isAllowedRecovery("map_low_signal", "hold_last_good_map")).toBe(true);
  });

  it("rejects unknown watch ids", () => {
    expect(isSupervisorWatchId("routing_hang")).toBe(true);
    expect(isSupervisorWatchId("invented_fix")).toBe(false);
  });

  it("builds and validates a field report", () => {
    const report = buildFieldReport({
      watchId: "search_hang",
      recovered: true,
      recovery: "abort_and_clear_busy",
      online: false,
      navigatorOnLine: true,
      reachable: false,
      screen: "plan",
      busyFlags: { suggestLoading: false, routing: false },
      queueSizes: { mapboxUsagePending: 2, jeffPending: 0 },
      stuckMs: 14000,
      appVersion: "4.20.6",
      iosBuild: "332",
      buildFlavor: "appstore",
      note: "autocomplete never settled",
    });

    expect(report.schema).toBe("stormpath.field_supervisor.v1");
    expect(isFieldSupervisorReport(report)).toBe(true);
    expect(isFieldSupervisorReport({ schema: "nope" })).toBe(false);
    expect(sentryHealthMessage("search_hang")).toBe(
      "stormpath.health.supervisor.search_hang"
    );
  });
});
