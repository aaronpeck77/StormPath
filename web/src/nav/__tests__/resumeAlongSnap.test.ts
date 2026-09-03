import { describe, expect, it } from "vitest";
import { stabilizeAlongMeters } from "../navigationProgress";
import {
  isFalseArrivalAlong,
  nextAlongAfterResume,
  shouldSnapAlongToCurrent,
} from "../resumeAlongSnap";

describe("isFalseArrivalAlong", () => {
  it("rejects a dest-end along while GPS is still mid-route", () => {
    expect(
      isFalseArrivalAlong({
        proposedAlongM: 49_920,
        routeLengthM: 50_000,
        gpsToDestM: 8_000,
      })
    ).toBe(true);
  });

  it("allows a dest-end along when GPS is actually at the pin", () => {
    expect(
      isFalseArrivalAlong({
        proposedAlongM: 49_920,
        routeLengthM: 50_000,
        gpsToDestM: 40,
      })
    ).toBe(false);
  });
});

describe("shouldSnapAlongToCurrent", () => {
  it("snaps the first GPS after a page refresh instead of walking from 0", () => {
    expect(
      shouldSnapAlongToCurrent({
        prevAlongM: 0,
        proposedAlongM: 18_400,
        unseeded: true,
        routeLengthM: 40_000,
        gpsToDestM: 21_000,
      })
    ).toBe(true);
  });

  it("does not snap driveway noise at Go", () => {
    expect(
      shouldSnapAlongToCurrent({
        prevAlongM: 0,
        proposedAlongM: 40,
        unseeded: true,
        routeLengthM: 40_000,
        gpsToDestM: 39_000,
      })
    ).toBe(false);
  });

  it("does not snap a dest-end match while still far from dest", () => {
    expect(
      shouldSnapAlongToCurrent({
        prevAlongM: 0,
        proposedAlongM: 39_950,
        unseeded: true,
        resumeSnap: true,
        routeLengthM: 40_000,
        gpsToDestM: 12_000,
      })
    ).toBe(false);
  });
});

describe("nextAlongAfterResume", () => {
  it("flips to current along on remount instead of tracing the trip", () => {
    let along = 0;
    for (let i = 0; i < 40; i++) {
      along = nextAlongAfterResume({
        prevAlongM: along,
        proposedAlongM: 22_000,
        unseeded: along <= 1,
        routeLengthM: 50_000,
        gpsToDestM: 28_000,
        stabilize: ({ prevAlongM, proposedAlongM }) =>
          stabilizeAlongMeters({
            prevAlongM,
            proposedAlongM,
            speedMps: null,
            dtS: 0.05,
          }),
      });
    }
    expect(along).toBe(22_000);
  });

  it("does not walk past current to the destination after resume", () => {
    let along = 0;
    for (let i = 0; i < 80; i++) {
      along = nextAlongAfterResume({
        prevAlongM: along,
        proposedAlongM: 49_900,
        unseeded: along <= 1,
        resumeSnap: i === 0,
        routeLengthM: 50_000,
        gpsToDestM: 9_000,
        stabilize: ({ prevAlongM, proposedAlongM }) =>
          stabilizeAlongMeters({
            prevAlongM,
            proposedAlongM,
            speedMps: null,
            dtS: 0.05,
          }),
      });
    }
    expect(along).toBeLessThan(200);
  });
});
