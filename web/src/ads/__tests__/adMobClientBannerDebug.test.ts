import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

vi.mock("@capacitor-community/admob", () => ({
  AdMob: {
    addListener: vi.fn(),
    initialize: vi.fn(),
    showBanner: vi.fn(),
    hideBanner: vi.fn(),
    removeBanner: vi.fn(),
    trackingAuthorizationStatus: vi.fn(),
    requestTrackingAuthorization: vi.fn(),
  },
  BannerAdPluginEvents: {
    FailedToLoad: "failedToLoad",
    Loaded: "loaded",
    SizeChanged: "bannerAdSizeChanged",
  },
  BannerAdPosition: { BOTTOM_CENTER: "BOTTOM_CENTER" },
  BannerAdSize: { BANNER: "BANNER" },
}));

import { Capacitor } from "@capacitor/core";
import {
  getBasicBannerDebugLine,
  readBannerHeightPx,
  recordBasicBannerUiSlot,
} from "../adMobClient";

describe("readBannerHeightPx", () => {
  it("reads the plugin size and treats a hidden banner as zero", () => {
    expect(readBannerHeightPx({ width: 320, height: 50 })).toBe(50);
    expect(readBannerHeightPx({ size: { height: 90 } })).toBe(90);
    expect(readBannerHeightPx({ height: 0 })).toBe(0);
    expect(readBannerHeightPx(null)).toBe(0);
  });
});

describe("getBasicBannerDebugLine", () => {
  it("reports web when not native", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    recordBasicBannerUiSlot("empty");
    expect(getBasicBannerDebugLine()).toMatch(/^ads: web \(no AdMob,/);
  });

  it("reports empty live fill on native Basic", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    recordBasicBannerUiSlot("empty");
    expect(getBasicBannerDebugLine()).toMatch(/^ads: empty \(test creatives,/);
  });

  it("reports showing while a banner is filled", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    recordBasicBannerUiSlot("filled");
    expect(getBasicBannerDebugLine()).toBe("ads: showing (test creatives)");
  });
});
