import { describe, expect, it } from "vitest";
import { displayText } from "../displayText";

describe("displayText", () => {
  it("collapses whitespace on normal strings", () => {
    expect(displayText("  Flash   Flood  ")).toBe("Flash Flood");
  });

  it("does not throw on null or undefined (CarPlay companion path)", () => {
    expect(displayText(null)).toBe("");
    expect(displayText(undefined)).toBe("");
  });
});
