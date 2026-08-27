import { describe, expect, it } from "vitest";
import {
  ROUTE_ACTIVE_LINE_WIDTH,
  routeLineWidthByZoom,
  routeLineWidthViewMode,
  routeMapLineStyle,
} from "../mapRouteStyle";

function widthAtZoom(expr: ReturnType<typeof routeLineWidthByZoom>, zoom: number) {
  const stops = expr.slice(3);
  for (let i = 0; i < stops.length; i += 2) {
    if (stops[i] === zoom) return stops[i + 1];
  }
  return undefined;
}

describe("routeLineWidthByZoom", () => {
  it("keeps Drive at the historic 8px planning stop and slimmer street zoom", () => {
    const expr = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "drive");
    expect(expr[0]).toBe("interpolate");
    expect(widthAtZoom(expr, 14)).toBe(8);
    expect(widthAtZoom(expr, 17.5)).toBe(14);
    expect((widthAtZoom(expr, 17.5) as number) > (widthAtZoom(expr, 14) as number)).toBe(true);
  });

  it("widens Rt a little at overview zoom without changing street zoom", () => {
    const drive = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "drive");
    const route = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "route");
    expect(widthAtZoom(route, 8)).toBe(3.5);
    expect(widthAtZoom(route, 12)).toBe(6.5);
    expect(widthAtZoom(route, 14)).toBe(10);
    expect(widthAtZoom(route, 12)).toBeGreaterThan(widthAtZoom(drive, 12) as number);
    expect(widthAtZoom(route, 14)).toBeGreaterThan(widthAtZoom(drive, 14) as number);
    expect(widthAtZoom(route, 17.5)).toBe(widthAtZoom(drive, 17.5));
    expect(widthAtZoom(route, 19)).toBe(widthAtZoom(drive, 19));
  });
});

describe("routeLineWidthViewMode", () => {
  it("only boosts the main Rt map, not Drive, Map, or the overview PiP", () => {
    expect(routeLineWidthViewMode("route")).toBe("route");
    expect(routeLineWidthViewMode("route", true)).toBe("drive");
    expect(routeLineWidthViewMode("drive")).toBe("drive");
    expect(routeLineWidthViewMode("topdown")).toBe("drive");
  });
});

describe("routeMapLineStyle", () => {
  it("uses cyan for the inactive alternate so B is visible on streets before Go", () => {
    const active = routeMapLineStyle(true);
    const alt = routeMapLineStyle(false);
    expect(active.color).toBe("#38bdf8");
    expect(alt.color).toBe("#7dd3fc");
    expect(alt.color).not.toBe(active.color);
  });
});
