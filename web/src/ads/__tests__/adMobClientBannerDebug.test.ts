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
  BannerAdPluginEvents: { FailedToLoad: "failedToLoad", Loaded: "loaded" },
  BannerAdPosition: { BOTTOM_CENTER: "BOTTOM_CENTER" },
  BannerAdSize: { BANNER: "BANNER" },
}));

import { Capacitor } from "@capacitor/core";
import {
  getBasicBannerCustomerHint,
  getBasicBannerDebugLine,
  recordBasicBannerUiSlot,
} from "../adMobClient";

describe("getBasicBannerDebugLine", () => {
  it("reports web when not native", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    recordBasicBannerUiSlot("empty");
    expect(getBasicBannerDebugLine()).toMatch(/^ads: web \(no AdMob,/);
    expect(getBasicBannerCustomerHint()).toBeNull();
  });

  it("reports empty live fill on native Basic", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    recordBasicBannerUiSlot("empty");
    expect(getBasicBannerDebugLine()).toMatch(/^ads: empty \(test creatives,/);
    expect(getBasicBannerCustomerHint()).toMatch(/None loaded this session/);
  });

  it("hides the customer hint while a banner is showing", () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    recordBasicBannerUiSlot("filled");
    expect(getBasicBannerDebugLine()).toBe("ads: showing (test creatives)");
    expect(getBasicBannerCustomerHint()).toBeNull();
  });
});
