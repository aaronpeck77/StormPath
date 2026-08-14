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

  it("is testflight when Vite mode is testflight", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "testflight");
    vi.stubEnv("VITE_PAY_TIER", "plus");
    expect(stormpathBuildFlavor()).toBe("testflight");
    expect(isForcedPlusBinary()).toBe(true);
    expect(stormpathFlavorChipLabel()).toBe("TestFlight");
  });
});
