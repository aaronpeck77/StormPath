import { describe, expect, it } from "vitest";
import { shouldUseNativeDriveMapShell } from "../nativeDriveMapShell";

describe("shouldUseNativeDriveMapShell", () => {
  it("uses the native map in Drive after Go when Core is active", () => {
    expect(
      shouldUseNativeDriveMapShell({
        nativeNavActive: true,
        navigationStarted: true,
        viewMode: "drive",
      })
    ).toBe(true);
  });

  it("stays on the web map for Mp/Rt or planning", () => {
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
