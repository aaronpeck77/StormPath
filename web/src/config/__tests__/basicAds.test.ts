import { describe, expect, it } from "vitest";
import {
  buildAdvisoryPromoLines,
  buildBasicNavAdvisoryPromoLines,
  buildBasicNavStatusPanelPromos,
} from "../basicAds";
import type { getWebEnv } from "../env";

type WebEnv = ReturnType<typeof getWebEnv>;

function env(over: Partial<Pick<WebEnv, "upgradeUrl" | "partnerAdUrl" | "basicAdsJson">> = {}): WebEnv {
  return {
    upgradeUrl: "",
    partnerAdUrl: "",
    basicAdsJson: "",
    ...over,
  } as WebEnv;
}

describe("Basic advisory promos", () => {
  it("never surfaces SiteBible copy on Basic", () => {
    const panel = buildBasicNavStatusPanelPromos(env());
    const rotator = buildBasicNavAdvisoryPromoLines(env());
    const advisory = buildAdvisoryPromoLines(env(), false);
    const blob = JSON.stringify({ panel, rotator, advisory });
    expect(blob.toLowerCase()).not.toMatch(/sitebible/);
    expect(blob.toLowerCase()).not.toMatch(/inventoy/);
    expect(panel.plusUpsell.id).toBe("sp-plus-upsell");
    expect(panel).not.toHaveProperty("siteBible");
  });

  it("drops a sitebible JSON override", () => {
    const rotator = buildBasicNavAdvisoryPromoLines(
      env({
        basicAdsJson: JSON.stringify([
          { id: "sitebible", text: "SiteBible — should not appear", sponsored: true },
        ]),
      })
    );
    expect(JSON.stringify(rotator).toLowerCase()).not.toMatch(/sitebible/);
  });

  it("only shows the partner slot when a URL is set", () => {
    expect(buildBasicNavAdvisoryPromoLines(env()).some((l) => l.id === "partner-sponsored")).toBe(
      false
    );
    expect(
      buildBasicNavAdvisoryPromoLines(env({ partnerAdUrl: "https://example.com/partner" })).some(
        (l) => l.id === "partner-sponsored"
      )
    ).toBe(true);
  });
});
