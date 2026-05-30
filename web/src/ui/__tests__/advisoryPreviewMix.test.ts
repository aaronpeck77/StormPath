import { describe, expect, it } from "vitest";
import { limitExpandedPromoLines, mixAdvisoryPreviewItems } from "../advisoryPreviewMix";

describe("mixAdvisoryPreviewItems", () => {
  it("interleaves trip and promo rows 1:1 when both pools have items", () => {
    const trip = ["t1", "t2", "t3"];
    const promo = ["p1", "p2", "p3", "p4", "p5"];
    expect(mixAdvisoryPreviewItems(trip, promo)).toEqual([
      "t1",
      "p1",
      "t2",
      "p2",
      "t3",
      "p3",
    ]);
  });

  it("caps promo rows when trip pool is smaller", () => {
    expect(mixAdvisoryPreviewItems(["t1"], ["p1", "p2", "p3"])).toEqual(["t1", "p1"]);
  });

  it("shows at most two promos when there is no trip context", () => {
    expect(mixAdvisoryPreviewItems([], ["p1", "p2", "p3"])).toEqual(["p1", "p2"]);
  });

  it("returns trip-only when promo pool is empty", () => {
    expect(mixAdvisoryPreviewItems(["t1", "t2"], [])).toEqual(["t1", "t2"]);
  });
});

describe("limitExpandedPromoLines", () => {
  it("trims promos when weather or route panels are visible", () => {
    const lines = ["a", "b", "c", "d"];
    expect(limitExpandedPromoLines(lines, true)).toEqual(["a", "b"]);
    expect(limitExpandedPromoLines(lines, false)).toEqual(lines);
  });
});
