import { describe, expect, it } from "vitest";
import {
  SEARCH_SUGGEST_ROW_PX,
  SEARCH_SUGGEST_VISIBLE_ROWS,
  searchSuggestListMaxHeightPx,
} from "../searchSuggestMaxHeight";

describe("searchSuggestListMaxHeightPx", () => {
  it("caps the list at four rows so the typing field stays put", () => {
    expect(SEARCH_SUGGEST_VISIBLE_ROWS).toBe(4);
    expect(searchSuggestListMaxHeightPx()).toBe(4 * SEARCH_SUGGEST_ROW_PX);
  });
});
