/**
 * Cap the destination suggestion list so the typing field stays on screen.
 * The search dock sits at the bottom; a 40vh list plus the iOS keyboard
 * used to shove the input off the top.
 */
export function searchSuggestMaxHeightPx(visibleViewportHeight: number): number {
  const h = Number.isFinite(visibleViewportHeight) ? visibleViewportHeight : 0;
  return Math.round(Math.max(88, Math.min(200, h * 0.28)));
}

export function visibleViewportHeightPx(): number {
  if (typeof window === "undefined") return 640;
  return window.visualViewport?.height ?? window.innerHeight;
}
