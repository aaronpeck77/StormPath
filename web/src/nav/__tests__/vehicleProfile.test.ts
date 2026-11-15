import { describe, expect, it } from "vitest";
import {
  DEFAULT_VEHICLE_PROFILE,
  normalizeVehicleProfile,
  readVehicleProfile,
  RV_VEHICLE_DIMS,
  TRUCK_VEHICLE_DIMS,
  VEHICLE_PROFILE_STORAGE_KEY,
  vehicleProfileMapboxParams,
  writeVehicleProfile,
} from "../vehicleProfile";
import { safeStorage } from "../../storage/safeStorage";

describe("normalizeVehicleProfile", () => {
  it("defaults to car mode with RV dims", () => {
    expect(normalizeVehicleProfile(undefined)).toEqual(DEFAULT_VEHICLE_PROFILE);
    expect(normalizeVehicleProfile({})).toEqual(DEFAULT_VEHICLE_PROFILE);
  });

  it("clamps dims into sane vehicle ranges", () => {
    const p = normalizeVehicleProfile({
      mode: "large",
      heightFt: 999,
      widthFt: -3,
      weightLb: "not-a-number",
    });
    expect(p.mode).toBe("large");
    expect(p.heightFt).toBe(20);
    expect(p.widthFt).toBe(4);
    expect(p.weightLb).toBe(RV_VEHICLE_DIMS.weightLb);
  });

  it("treats any non-large mode as car", () => {
    expect(normalizeVehicleProfile({ mode: "truck" }).mode).toBe("car");
    expect(normalizeVehicleProfile({ mode: "large" }).mode).toBe("large");
  });
});

describe("vehicleProfileMapboxParams", () => {
  it("returns null for car — requests stay identical to before", () => {
    expect(vehicleProfileMapboxParams(DEFAULT_VEHICLE_PROFILE)).toBeNull();
    expect(
      vehicleProfileMapboxParams({ ...DEFAULT_VEHICLE_PROFILE, mode: "car" })
    ).toBeNull();
  });

  it("converts ft/lb to Mapbox metric units for large vehicles", () => {
    const p = vehicleProfileMapboxParams({
      mode: "large",
      ...RV_VEHICLE_DIMS,
    });
    expect(p).not.toBeNull();
    /* 13.5 ft = 4.1148 m → 4.115; 8.5 ft = 2.5908 m → 2.591; 30,000 lb = 13.6078 t → 13.608 */
    expect(p!.max_height).toBeCloseTo(4.115, 3);
    expect(p!.max_width).toBeCloseTo(2.591, 3);
    expect(p!.max_weight).toBeCloseTo(13.608, 3);
  });

  it("keeps truck defaults inside API limits", () => {
    const p = vehicleProfileMapboxParams({ mode: "large", ...TRUCK_VEHICLE_DIMS });
    expect(p!.max_height).toBeLessThanOrEqual(10);
    expect(p!.max_width).toBeLessThanOrEqual(10);
    expect(p!.max_weight).toBeLessThanOrEqual(100);
    /* 80,000 lb ≈ 36.3 t */
    expect(p!.max_weight).toBeCloseTo(36.287, 2);
  });
});

describe("vehicle profile storage", () => {
  it("round-trips through safeStorage", () => {
    safeStorage.set(VEHICLE_PROFILE_STORAGE_KEY, "");
    const profile = { mode: "large" as const, heightFt: 12, widthFt: 8, weightLb: 24000 };
    writeVehicleProfile(profile);
    expect(readVehicleProfile()).toEqual({
      mode: "large",
      heightFt: 12,
      widthFt: 8,
      weightLb: 24000,
    });
    safeStorage.set(VEHICLE_PROFILE_STORAGE_KEY, "");
  });

  it("falls back to defaults on corrupt JSON", () => {
    safeStorage.set(VEHICLE_PROFILE_STORAGE_KEY, "{not json");
    expect(readVehicleProfile()).toEqual(DEFAULT_VEHICLE_PROFILE);
    safeStorage.set(VEHICLE_PROFILE_STORAGE_KEY, "");
  });
});
