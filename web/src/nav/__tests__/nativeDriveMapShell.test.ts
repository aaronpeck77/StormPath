import { describe, expect, it } from "vitest";
import { shouldUseNativeDriveMapShell } from "../nativeDriveMapShell";

describe("shouldUseNativeDriveMapShell", () => {
  it("keeps Drive on the web map so pitch and 3D buildings stay visible", () => {
    expect(
      shouldUseNativeDriveMapShell({
        nativeNavActive: true,
        navigationStarted: true,
        viewMode: "drive",
      })
    ).toBe(false);
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
