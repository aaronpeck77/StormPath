import workflow from "../../../../.github/workflows/ios-build.yml?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isForcedPlusBinary, stormpathBuildFlavor, stormpathFlavorChipLabel } from "../buildFlavor";

describe("stormpathBuildFlavor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is appstore in production Vite builds", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_PAY_TIER", "");
    expect(stormpathBuildFlavor()).toBe("appstore");
    expect(isForcedPlusBinary()).toBe(false);
    expect(stormpathFlavorChipLabel()).toBe("App Store");
  });

  it("passes the RevenueCat SDK key into the TestFlight web build", () => {
    const step = workflow.split("      - name:").find((block) => block.includes("run: npm run build:testflight"));
    expect(step).toContain("VITE_REVENUECAT_API_KEY_IOS: ${{ secrets.VITE_REVENUECAT_API_KEY_IOS }}");
  });

  it("is testflight when Vite mode is testflight", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "testflight");
    vi.stubEnv("VITE_PAY_TIER", "plus");
    expect(stormpathBuildFlavor()).toBe("testflight");
    expect(isForcedPlusBinary()).toBe(true);
    expect(stormpathFlavorChipLabel()).toBe("TestFlight");
  });
});
