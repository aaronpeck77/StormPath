import { describe, expect, it } from "vitest";
import {
  ROUTE_ACTIVE_LINE_WIDTH,
  ROUTE_LINE_CASING_COLOR,
  ROUTE_LINE_CASING_WIDTH_EXTRA,
  routeCasingWidthByZoom,
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
  it("keeps Drive street zoom close to pavement width", () => {
    const expr = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "drive");
    expect(expr[0]).toBe("interpolate");
    expect(widthAtZoom(expr, 14)).toBe(4.5);
    expect(widthAtZoom(expr, 17.5)).toBe(7);
    expect((widthAtZoom(expr, 17.5) as number) > (widthAtZoom(expr, 14) as number)).toBe(true);
  });

  it("widens Rt a little at overview zoom without changing street zoom", () => {
    const drive = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "drive");
    const route = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "route");
    expect(widthAtZoom(route, 8)).toBe(2.5);
    expect(widthAtZoom(route, 12)).toBe(4.5);
    expect(widthAtZoom(route, 14)).toBe(6);
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

describe("route casing", () => {
  it("uses a thin black outline around the colored line", () => {
    expect(ROUTE_LINE_CASING_COLOR).toBe("#000000");
    expect(ROUTE_LINE_CASING_WIDTH_EXTRA).toBeGreaterThanOrEqual(4);
    expect(ROUTE_LINE_CASING_WIDTH_EXTRA).toBeLessThan(8);
    const core = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "drive");
    const casing = routeCasingWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "drive");
    expect(casing[0]).toBe("+");
    expect(casing[1]).toEqual(core);
    expect(casing[2]).toBe(ROUTE_LINE_CASING_WIDTH_EXTRA);
  });
});

describe("routeMapLineStyle", () => {
  it("uses cyan for the inactive alternate so B is visible on streets before Go", () => {
    const active = routeMapLineStyle(true);
    const alt = routeMapLineStyle(false);
    expect(active.color).toBe("#38bdf8");
    expect(alt.color).toBe("#bae6fd");
    expect(alt.color).not.toBe(active.color);
  });
});
