import { beforeEach, describe, expect, it } from "vitest";
import { __resetSafeStorageForTests } from "../../storage/safeStorage";
import { recordJeffFix, readLocalJeffFixLog } from "../jeffFixLog";
import { reportJeffSighting } from "../../ui/jeffTheBot";

describe("jeffFixLog", () => {
  beforeEach(() => {
    __resetSafeStorageForTests();
  });

  it("appends recorded fixes to the local log in order", () => {
    recordJeffFix({ domain: "drive_camera", note: "Straightened out the map view", atMs: 1 });
    recordJeffFix({ domain: "live_traffic", note: "Kicked live traffic to refresh", atMs: 2, manual: true });

    const log = readLocalJeffFixLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ domain: "drive_camera", manual: false, atMs: 1 });
    expect(log[1]).toMatchObject({ domain: "live_traffic", manual: true, atMs: 2 });
  });

  it("caps the local log so it can't grow without bound", () => {
    for (let i = 0; i < 130; i += 1) {
      recordJeffFix({ domain: "drive_camera", note: "n", atMs: i });
    }
    const log = readLocalJeffFixLog();
    expect(log.length).toBeLessThanOrEqual(120);
    // Oldest entries were dropped first — the newest one is still present.
    expect(log.at(-1)?.atMs).toBe(129);
  });

  it("every reported Jeff sighting — automatic or manual — lands in the local log", () => {
    reportJeffSighting("drive_camera", "Straightened out the map view");
    reportJeffSighting("drive_camera", "You straightened out the map view.", true);

    const log = readLocalJeffFixLog();
    expect(log).toHaveLength(2);
    expect(log[0].manual).toBe(false);
    expect(log[1].manual).toBe(true);
  });
});
