import { describe, expect, it } from "vitest";
import { spokenPlace } from "../spokenPlace";

describe("spokenPlace", () => {
  it("drops the home city, state, and zip", () => {
    expect(
      spokenPlace("Casey's, 2100 Mount Zion Rd, Decatur, Illinois 62521, United States", "Decatur, Illinois")
    ).toBe("Casey's, 2100 Mount Zion Rd");
  });

  it("keeps a city in another town and a state when it changes", () => {
    expect(
      spokenPlace("Casey's, 100 Main St, Springfield, Missouri 65802", "Decatur, Illinois")
    ).toBe("Casey's, 100 Main St, Springfield, Missouri");
  });

  it("keeps the city when only the town changes", () => {
    expect(spokenPlace("Casey, 100 Main St, Springfield, IL 62701", "Decatur, IL")).toBe(
      "Casey, 100 Main St, Springfield"
    );
  });
});
