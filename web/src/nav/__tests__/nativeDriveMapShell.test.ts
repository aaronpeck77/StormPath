import { describe, expect, it } from "vitest";
import { shouldUseNativeDriveMapShell } from "../nativeDriveMapShell";

describe("shouldUseNativeDriveMapShell", () => {
  it("hands Drive to the native map when Core is guiding", () => {
    expect(
      shouldUseNativeDriveMapShell({
        nativeNavActive: true,
        navigationStarted: true,
        viewMode: "drive",
      })
    ).toBe(true);
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
