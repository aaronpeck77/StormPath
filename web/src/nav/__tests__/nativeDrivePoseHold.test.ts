import { describe, expect, it } from "vitest";
import { createNativeDrivePoseHold } from "../nativeDrivePoseHold";

describe("createNativeDrivePoseHold", () => {
  it("accepts the first fix", () => {
    const hold = createNativeDrivePoseHold();
    const r = hold.accept({ lng: -90.2, lat: 38.63, alongM: 10, headingDeg: 90, speedMps: 12 }, 1_000);
    expect(r.held).toBe(false);
    expect(r.pose.lng).toBe(-90.2);
  });

  it("holds a Canada-scale leap in under 800ms", () => {
    const hold = createNativeDrivePoseHold();
    hold.accept({ lng: -90.2, lat: 38.63, alongM: 10, headingDeg: 90, speedMps: 12 }, 1_000);
    const r = hold.accept({ lng: -79.4, lat: 43.7, alongM: 10, headingDeg: 90, speedMps: 12 }, 1_200);
    expect(r.held).toBe(true);
    expect(r.pose.lat).toBeCloseTo(38.63);
    expect(r.pose.lng).toBeCloseTo(-90.2);
  });

  it("accepts a normal driving step", () => {
    const hold = createNativeDrivePoseHold();
    hold.accept({ lng: -90.2, lat: 38.63, alongM: 10, headingDeg: 90, speedMps: 12 }, 1_000);
    const r = hold.accept({ lng: -90.1995, lat: 38.6302, alongM: 40, headingDeg: 88, speedMps: 13 }, 1_250);
    expect(r.held).toBe(false);
    expect(r.pose.alongM).toBe(40);
  });
});
