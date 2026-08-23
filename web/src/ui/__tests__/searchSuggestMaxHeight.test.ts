import { describe, expect, it } from "vitest";
import { searchSuggestMaxHeightPx } from "../searchSuggestMaxHeight";

describe("searchSuggestMaxHeightPx", () => {
  it("keeps a short list on a keyboard-shrunk phone viewport", () => {
    expect(searchSuggestMaxHeightPx(360)).toBeLessThanOrEqual(120);
    expect(searchSuggestMaxHeightPx(360)).toBeGreaterThanOrEqual(88);
  });

  it("caps on a tall desktop so the dock does not eat the map", () => {
    expect(searchSuggestMaxHeightPx(1200)).toBe(200);
  });
});
