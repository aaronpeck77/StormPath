import { describe, expect, it } from "vitest";
import { ROUTE_ACTIVE_LINE_WIDTH, routeLineWidthByZoom } from "../mapRouteStyle";

describe("routeLineWidthByZoom", () => {
  it("keeps the historic 8px width at planning zoom and widens at street zoom", () => {
    const expr = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH);
    expect(expr[0]).toBe("interpolate");
    const stops = expr.slice(3);
    const widthAt = (zoom: number) => {
      for (let i = 0; i < stops.length; i += 2) {
        if (stops[i] === zoom) return stops[i + 1];
      }
      return undefined;
    };
    expect(widthAt(14)).toBe(8);
    expect(widthAt(17.5)).toBe(18);
    expect((widthAt(17.5) as number) > (widthAt(14) as number)).toBe(true);
  });
});
