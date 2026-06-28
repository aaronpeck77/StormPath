import { describe, expect, it } from "vitest";
import {
  feelsLikeCellColor,
  heatStressLabel,
  precipTypeColor,
  precipTypeShortLabel,
  uvIndexLabel,
  windGustBarHeight,
} from "../localForecastVisual";

describe("localForecastVisual", () => {
  it("colors precip by type and intensity", () => {
    expect(precipTypeColor(0, 0, 0)).toContain("148");
    expect(precipTypeColor(2, 2, 0.5)).toBe("#e0f2fe");
    expect(precipTypeColor(3, 0.5, 0.2)).toBe("#c084fc");
  });

  it("escalates heat stress labels", () => {
    expect(heatStressLabel(70)).toBeNull();
    expect(heatStressLabel(88)).toBe("Hot — stay hydrated");
    expect(heatStressLabel(98)).toBe("High heat index");
  });

  it("maps feels-like to warm/cool colors", () => {
    expect(feelsLikeCellColor(20)).toContain("59, 130, 246");
    expect(feelsLikeCellColor(100)).toContain("234, 88, 12");
  });

  it("scales wind gust bars", () => {
    expect(windGustBarHeight(0)).toBe("12%");
    expect(parseInt(windGustBarHeight(45), 10)).toBeGreaterThan(90);
  });

  it("labels precip and UV tiers", () => {
    expect(precipTypeShortLabel(4)).toBe("Sleet / ice");
    expect(uvIndexLabel(7)).toBe("High UV");
  });
});
