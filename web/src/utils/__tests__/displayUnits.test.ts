import { describe, expect, it } from "vitest";
import {
  allowUsSpeedLimitGuess,
  displaySpeed,
  roadUsesMiles,
  weatherUsesFahrenheit,
} from "../displayUnits";

describe("displayUnits", () => {
  it("keeps miles and Fahrenheit in the US", () => {
    const chicago: [number, number] = [-87.63, 41.88];
    expect(roadUsesMiles(chicago)).toBe(true);
    expect(weatherUsesFahrenheit(chicago)).toBe(true);
    expect(allowUsSpeedLimitGuess(chicago)).toBe(true);
    expect(displaySpeed(56, true)).toBe(56);
  });

  it("uses kilometers and Celsius in Italy", () => {
    const rome: [number, number] = [12.5, 41.9];
    expect(roadUsesMiles(rome)).toBe(false);
    expect(weatherUsesFahrenheit(rome)).toBe(false);
    expect(allowUsSpeedLimitGuess(rome)).toBe(false);
    expect(displaySpeed(56, false)).toBe(90);
  });

  it("keeps miles in Britain and Celsius for the weather", () => {
    const london: [number, number] = [-0.12, 51.5];
    expect(roadUsesMiles(london)).toBe(true);
    expect(weatherUsesFahrenheit(london)).toBe(false);
    expect(allowUsSpeedLimitGuess(london)).toBe(false);
  });

  it("uses kilometers in Ireland and Mexico", () => {
    expect(roadUsesMiles([-6.26, 53.35])).toBe(false);
    expect(roadUsesMiles([-99.13, 19.43])).toBe(false);
    expect(roadUsesMiles([-5.93, 54.6])).toBe(true);
  });

  it("stays on miles before GPS arrives", () => {
    expect(roadUsesMiles(null)).toBe(true);
    expect(weatherUsesFahrenheit(null)).toBe(true);
  });
});
