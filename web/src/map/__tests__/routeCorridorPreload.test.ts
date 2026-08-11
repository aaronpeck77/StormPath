import { describe, expect, it } from "vitest";
import type { LngLat } from "../../nav/types";
import {
  corridorWindowBounds,
  nextCorridorWindowStartM,
  shouldPrefetchNextCorridorWindow,
  CORRIDOR_WINDOW_M,
  CORRIDOR_OVERLAP_M,
} from "../routeCorridorPreload";

/** ~eastbound line near Decatur IL */
function line(): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < 40; i++) {
    out.push([-88.95 + i * 0.01, 39.84]);
  }
  return out;
}

describe("routeCorridorPreload", () => {
  it("builds a padded window ahead of alongM", () => {
    const b = corridorWindowBounds(line(), 0);
    expect(b).not.toBeNull();
    const [[w, s], [e, n]] = b!;
    expect(e).toBeGreaterThan(w);
    expect(n).toBeGreaterThan(s);
  });

  it("advances windows with overlap (no hard border gap)", () => {
    const a = 0;
    const b = nextCorridorWindowStartM(a);
    expect(b).toBe(CORRIDOR_WINDOW_M - CORRIDOR_OVERLAP_M);
    expect(b).toBeLessThan(CORRIDOR_WINDOW_M);
  });

  it("triggers ahead prefetch near the end of the warm window (~3 mi)", () => {
    expect(shouldPrefetchNextCorridorWindow(5_000, 0)).toBe(false);
    expect(shouldPrefetchNextCorridorWindow(CORRIDOR_WINDOW_M - 3_000, 0)).toBe(true);
    expect(shouldPrefetchNextCorridorWindow(CORRIDOR_WINDOW_M - 10_000, 0)).toBe(false);
  });
});
