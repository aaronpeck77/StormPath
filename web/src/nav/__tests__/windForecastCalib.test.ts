import { describe, expect, it } from "vitest";
import {
  calibratedWindGustMph,
  windImpactSeverity,
  WIND_GUST_CAUTION_MPH,
} from "../windForecastCalib";

describe("windForecastCalib", () => {
  it("returns sustained wind when gust is missing or trivial", () => {
    expect(calibratedWindGustMph(18, 0)).toBe(18);
    expect(calibratedWindGustMph(22, 24)).toBe(22);
  });

  it("caps model gust spikes above sustained wind", () => {
    expect(calibratedWindGustMph(20, 45)).toBe(35);
    expect(calibratedWindGustMph(30, 58)).toBe(45);
  });

  it("keeps meaningful gusts within the cap band", () => {
    expect(calibratedWindGustMph(25, 38)).toBe(38);
  });

  it("only warns at raised driving thresholds", () => {
    expect(windImpactSeverity(30)).toBeNull();
    expect(windImpactSeverity(WIND_GUST_CAUTION_MPH)).toBe("caution");
    expect(windImpactSeverity(50)).toBe("serious");
    expect(windImpactSeverity(62)).toBe("avoid");
  });
});
