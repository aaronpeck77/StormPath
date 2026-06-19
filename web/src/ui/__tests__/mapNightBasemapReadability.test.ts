import { describe, expect, it } from "vitest";
import { lightenHexColor, nightRoadLineColorForLayerId } from "../mapNightBasemapReadability";

describe("lightenHexColor", () => {
  it("mixes toward white", () => {
    expect(lightenHexColor("#000000", 0.5)).toBe("#808080");
    expect(lightenHexColor("#000", 1)).toBe("#ffffff");
  });

  it("returns original when not hex", () => {
    expect(lightenHexColor("rgb(0,0,0)", 0.5)).toBe("rgb(0,0,0)");
  });
});

describe("nightRoadLineColorForLayerId", () => {
  it("picks brighter tiers by road class", () => {
    expect(nightRoadLineColorForLayerId("road-motorway-trunk")).toBe("#fde68a");
    expect(nightRoadLineColorForLayerId("road-street")).toBe("#d1dae4");
  });
});
