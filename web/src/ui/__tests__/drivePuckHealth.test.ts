import { describe, expect, it } from "vitest";
import {
  auditDrivePuckPlacement,
  DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX,
  expectedDrivePuckScreenAnchorPx,
  readDrivePuckAnchorDrift,
  repairActionsForDrivePuckIssues,
} from "../drivePuckHealth";

describe("expectedDrivePuckScreenAnchorPx", () => {
  it("places the anchor at the padded viewport center plus Mapbox offset", () => {
    expect(
      expectedDrivePuckScreenAnchorPx({
        mapWidth: 400,
        mapHeight: 800,
        padding: { top: 200, bottom: 160, left: 40, right: 40 },
        offset: [0, 80],
      })
    ).toEqual({
      // x: 40 + (400-80)/2 + 0 = 200
      // y: 200 + (800-360)/2 + 80 = 200 + 220 + 80 = 500
      x: 200,
      y: 500,
    });
  });
});

describe("auditDrivePuckPlacement", () => {
  it("passes when the puck sits on the yard-line anchor", () => {
    const audit = auditDrivePuckPlacement({ driftPx: 12, speedMps: 15 });
    expect(audit.ok).toBe(true);
    expect(audit.issues).toHaveLength(0);
  });

  it("flags soft drift while moving", () => {
    const audit = auditDrivePuckPlacement({ driftPx: 70, speedMps: 15 });
    expect(audit.ok).toBe(false);
    expect(audit.severe).toBe(false);
    expect(audit.issues).toContain("puck_drifted_from_anchor");
    expect(repairActionsForDrivePuckIssues(audit.issues)).toEqual(["resync_camera"]);
  });

  it("marks severe drift when the puck has clearly climbed the frozen map", () => {
    const audit = auditDrivePuckPlacement({ driftPx: 140, speedMps: 20 });
    expect(audit.ok).toBe(false);
    expect(audit.severe).toBe(true);
  });

  it("ignores drift while crawling / stopped", () => {
    const audit = auditDrivePuckPlacement({ driftPx: 140, speedMps: 1 });
    expect(audit.ok).toBe(true);
  });

  it("skips when drift is unknown (exploring / not in drive follow)", () => {
    const audit = auditDrivePuckPlacement({ driftPx: null, speedMps: 15 });
    expect(audit.ok).toBe(true);
  });
});

describe("readDrivePuckAnchorDrift", () => {
  const padding = { top: 200, bottom: 160, left: 40, right: 40 };
  const offset = [0, 80] as const;

  it("reports yard-line hypot and stays on-canvas near the anchor", () => {
    const sight = readDrivePuckAnchorDrift({
      project: () => ({ x: 200, y: 500 }),
      puck: [-77, 39],
      mapWidth: 400,
      mapHeight: 800,
      padding,
      offset,
      exploring: false,
    });
    expect(sight.offCanvas).toBe(false);
    expect(sight.driftPx).toBe(0);
    expect(sight.reportPx).toBe(0);
  });

  it("flags a puck that projected off the canvas", () => {
    const sight = readDrivePuckAnchorDrift({
      project: () => ({ x: -40, y: 200 }),
      puck: [-77, 39],
      mapWidth: 400,
      mapHeight: 800,
      padding,
      offset,
      exploring: false,
    });
    expect(sight.offCanvas).toBe(true);
    expect(sight.reportPx).toBeGreaterThanOrEqual(DRIVE_PUCK_ANCHOR_SEVERE_DRIFT_PX);
  });

  it("stays quiet while the driver is exploring", () => {
    const sight = readDrivePuckAnchorDrift({
      project: () => ({ x: -40, y: 200 }),
      puck: [-77, 39],
      mapWidth: 400,
      mapHeight: 800,
      padding,
      offset,
      exploring: true,
    });
    expect(sight.driftPx).toBeNull();
    expect(sight.offCanvas).toBe(false);
    expect(sight.reportPx).toBeNull();
  });
});
