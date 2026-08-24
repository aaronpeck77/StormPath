/** Visible suggestion rows above the typing field. Extra matches scroll inside the list. */
export const SEARCH_SUGGEST_VISIBLE_ROWS = 4;

/** Two-line row (name + address) including padding — keep in sync with `.nav-search-suggestion`. */
export const SEARCH_SUGGEST_ROW_PX = 56;

/** Max height of the scrollable list only. The typing field is not included. */
export function searchSuggestListMaxHeightPx(
  rowPx = SEARCH_SUGGEST_ROW_PX,
  rows = SEARCH_SUGGEST_VISIBLE_ROWS
): number {
  return rowPx * rows;
}
