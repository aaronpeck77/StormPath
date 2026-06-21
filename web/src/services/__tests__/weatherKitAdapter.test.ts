import { describe, expect, it } from "vitest";
import { weatherKitConditionToCode } from "../weatherKit";

describe("weatherKitConditionToCode", () => {
  it("maps severe conditions to Tomorrow.io-style codes", () => {
    expect(weatherKitConditionToCode("Thunderstorms")).toBe(8000);
    expect(weatherKitConditionToCode("HeavyRain")).toBe(4201);
    expect(weatherKitConditionToCode("Clear")).toBe(1000);
    expect(weatherKitConditionToCode("PartlyCloudy")).toBe(1101);
  });
});
