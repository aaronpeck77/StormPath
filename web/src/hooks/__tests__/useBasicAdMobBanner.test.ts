import { describe, expect, it } from "vitest";
import {
  bannerShouldReserveBottomSpace,
  basicAdChromeLiftPx,
  slotStateAfterShowAttempt,
} from "../useBasicAdMobBanner";
import { buildAppShellStyle } from "../../ui/appShellChrome";

describe("bannerShouldReserveBottomSpace", () => {
  const shown = {
    isBasicTier: true,
    enabled: true,
    navigationStarted: false,
    native: true,
    slotState: "filled" as const,
    devWebPlaceholder: false,
  };

  it("reserves while a native banner is loading or filled", () => {
    expect(bannerShouldReserveBottomSpace({ ...shown, slotState: "loading" })).toBe(true);
    expect(bannerShouldReserveBottomSpace({ ...shown, slotState: "filled" })).toBe(true);
  });

  it("does not leave a blank hole when Google returns no fill", () => {
    expect(bannerShouldReserveBottomSpace({ ...shown, slotState: "empty" })).toBe(false);
    expect(bannerShouldReserveBottomSpace({ ...shown, slotState: "hidden" })).toBe(false);
  });

  it("hides the slot for Plus, driving, or web production", () => {
    expect(bannerShouldReserveBottomSpace({ ...shown, isBasicTier: false })).toBe(false);
    expect(bannerShouldReserveBottomSpace({ ...shown, enabled: false })).toBe(false);
    expect(bannerShouldReserveBottomSpace({ ...shown, navigationStarted: true })).toBe(false);
    expect(bannerShouldReserveBottomSpace({ ...shown, native: false })).toBe(false);
  });

  it("stays off for the whole trip, including when Status is open", () => {
    expect(
      bannerShouldReserveBottomSpace({
        ...shown,
        navigationStarted: true,
        stormBarExpanded: false,
      })
    ).toBe(false);
    expect(
      bannerShouldReserveBottomSpace({
        ...shown,
        navigationStarted: true,
        stormBarExpanded: true,
      })
    ).toBe(false);
  });

  it("keeps the buttons up while a measured banner is still on screen", () => {
    expect(
      bannerShouldReserveBottomSpace({ ...shown, slotState: "empty", bannerHeightPx: 50 })
    ).toBe(true);
    expect(
      bannerShouldReserveBottomSpace({
        ...shown,
        slotState: "empty",
        navigationStarted: true,
        bannerHeightPx: 90,
      })
    ).toBe(true);
    expect(basicAdChromeLiftPx({ reservesBottomSpace: true, bannerHeightPx: 90 })).toBe(90);
    expect(basicAdChromeLiftPx({ reservesBottomSpace: true, bannerHeightPx: 0 })).toBe(50);
    expect(basicAdChromeLiftPx({ reservesBottomSpace: false, bannerHeightPx: 90 })).toBe(0);
  });

  it("writes the live banner height onto the shell", () => {
    const up = buildAppShellStyle(90) as Record<string, string> | undefined;
    expect(up?.["--basic-ad-banner-reserve"]).toBe("90px");
    const down = buildAppShellStyle(0) as Record<string, string> | undefined;
    expect(down?.["--basic-ad-banner-reserve"]).toBeUndefined();
  });

  it("pads local browser dev so layout matches the phone", () => {
    expect(
      bannerShouldReserveBottomSpace({
        ...shown,
        native: false,
        slotState: "hidden",
        devWebPlaceholder: true,
      })
    ).toBe(true);
  });
});

describe("slotStateAfterShowAttempt", () => {
  it("ignores stale results after the effect was cancelled", () => {
    expect(slotStateAfterShowAttempt({ cancelled: true, shown: true })).toBeNull();
    expect(slotStateAfterShowAttempt({ cancelled: true, shown: false })).toBeNull();
  });

  it("marks empty only when the current show call failed to start", () => {
    expect(slotStateAfterShowAttempt({ cancelled: false, shown: false })).toBe("empty");
    expect(slotStateAfterShowAttempt({ cancelled: false, shown: true })).toBeNull();
  });
});
