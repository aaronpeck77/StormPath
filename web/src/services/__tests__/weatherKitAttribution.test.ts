import { describe, expect, it } from "vitest";
import {
  WEATHERKIT_ATTRIBUTION_FALLBACK,
  weatherKitMarkUrlForTheme,
  type WeatherKitAttribution,
} from "../weatherKitAttribution";

describe("weatherKitMarkUrlForTheme", () => {
  const attr: WeatherKitAttribution = {
    ...WEATHERKIT_ATTRIBUTION_FALLBACK,
    combinedMarkDarkURL: "https://example.test/dark.svg",
    combinedMarkLightURL: "https://example.test/light.svg",
  };

  it("uses light mark on dark UI and dark mark on light UI", () => {
    expect(weatherKitMarkUrlForTheme(attr, "dark")).toBe(attr.combinedMarkLightURL);
    expect(weatherKitMarkUrlForTheme(attr, "light")).toBe(attr.combinedMarkDarkURL);
  });

  it("falls back when a mark URL is missing", () => {
    const partial: WeatherKitAttribution = {
      ...attr,
      combinedMarkLightURL: "",
    };
    expect(weatherKitMarkUrlForTheme(partial, "dark")).toBe(attr.combinedMarkDarkURL);
  });
});

describe("WEATHERKIT_ATTRIBUTION_FALLBACK", () => {
  it("always has a legal page for App Review", () => {
    expect(WEATHERKIT_ATTRIBUTION_FALLBACK.legalPageURL).toMatch(/^https:\/\//);
    expect(WEATHERKIT_ATTRIBUTION_FALLBACK.serviceName.toLowerCase()).toContain("weather");
  });
});
