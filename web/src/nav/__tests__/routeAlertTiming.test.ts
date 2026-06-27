import { describe, expect, it } from "vitest";
import {
  alertShowsOnDriveMap,
  developingLaterNote,
  formatRouteAlertTiming,
  ROUTE_ALERT_RELEVANCE_DEVELOPING,
  ROUTE_ALERT_RELEVANCE_OVER_BEFORE,
} from "../routeAlertTiming";

describe("formatRouteAlertTiming", () => {
  const base = {
    startMeters: 50_000,
    endMeters: 55_000,
    userAlongMeters: 10_000,
    totalMeters: 200_000,
    planEtaMinutes: 120,
    driveEtaMinutes: 100,
    crossesRoute: true,
  };

  it("marks alerts that expire before arrival as stale", () => {
    const now = 1_000_000;
    const enterMin = 90;
    const timing = formatRouteAlertTiming({
      ...base,
      expiresIso: new Date(now + (enterMin - 10) * 60_000).toISOString(),
    });
    expect(timing.relevanceNote).toBe(ROUTE_ALERT_RELEVANCE_OVER_BEFORE);
    expect(timing.staleBeforeArrival).toBe(true);
    expect(timing.promoteToTop).toBe(false);
    expect(alertShowsOnDriveMap(timing)).toBe(false);
  });

  it("promotes still-active hazards within the imminent window", () => {
    const timing = formatRouteAlertTiming({
      ...base,
      startMeters: 30_000,
      endMeters: 35_000,
      expiresIso: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
    });
    expect(timing.relevanceNote).toContain("still active");
    expect(timing.promoteToTop).toBe(true);
    expect(timing.staleBeforeArrival).toBe(false);
  });

  it("detects developing hazards with future onset overlapping arrival", () => {
    const now = Date.now();
    const enterMin = 75;
    const onsetIso = new Date(now + 50 * 60_000).toISOString();
    const note = developingLaterNote(
      onsetIso,
      enterMin,
      new Date(now + 4 * 60 * 60_000).toISOString(),
      now
    );
    expect(note).toBe(ROUTE_ALERT_RELEVANCE_DEVELOPING);

    const timing = formatRouteAlertTiming({
      ...base,
      startMeters: 180_000,
      endMeters: 185_000,
      onsetIso,
      expiresIso: new Date(now + 4 * 60 * 60_000).toISOString(),
      driveEtaMinutes: 100,
    });
    expect(timing.developingLater).toBe(true);
    expect(timing.timingLine).toContain("Developing");
  });
});
