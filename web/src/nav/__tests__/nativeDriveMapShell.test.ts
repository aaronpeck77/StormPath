import { describe, expect, it } from "vitest";
import {
  NATIVE_DRIVE_FOLLOW_CAM_ENABLED,
  NATIVE_DRIVE_MAP_ENABLED,
  shouldUseNativeDriveMapShell,
} from "../nativeDriveMapShell";

describe("shouldUseNativeDriveMapShell", () => {
  it("keeps Drive on the StormPath map while the native shell is off", () => {
    expect(NATIVE_DRIVE_MAP_ENABLED).toBe(false);
    expect(
      shouldUseNativeDriveMapShell({
        nativeNavActive: true,
        navigationStarted: true,
        viewMode: "drive",
      })
    ).toBe(false);
  });

  it("still takes Core's follow-cam sample — one owner does not depend on the native map", () => {
    expect(NATIVE_DRIVE_FOLLOW_CAM_ENABLED).toBe(true);
  });

  it("stays off for Mp/Rt or when Core is not running", () => {
    expect(
      shouldUseNativeDriveMapShell({
        nativeNavActive: true,
        navigationStarted: true,
        viewMode: "topdown",
      })
    ).toBe(false);
    expect(
      shouldUseNativeDriveMapShell({
        nativeNavActive: false,
        navigationStarted: true,
        viewMode: "drive",
      })
    ).toBe(false);
  });
});
