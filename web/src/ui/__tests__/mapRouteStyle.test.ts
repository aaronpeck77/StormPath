import { describe, expect, it } from "vitest";
import {
  ROUTE_ACTIVE_LINE_WIDTH,
  ROUTE_LINE_CASING_COLOR,
  ROUTE_LINE_CASING_WIDTH_EXTRA,
  routeCasingExtraByZoom,
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

function extraAtZoom(expr: ReturnType<typeof routeCasingExtraByZoom>, zoom: number) {
  const stops = expr.slice(3);
  for (let i = 0; i < stops.length; i += 2) {
    if (stops[i] === zoom) return stops[i + 1];
  }
  return undefined;
}

describe("route casing", () => {
  it("uses a black outline that is wide enough to survive Drive pitch and anti-alias", () => {
    expect(ROUTE_LINE_CASING_COLOR).toBe("#000000");
    /* +4 vanished on the phone. Street extra 8 ≈ 4 px/side in the style. */
    expect(ROUTE_LINE_CASING_WIDTH_EXTRA).toBeGreaterThanOrEqual(8);
    expect(ROUTE_LINE_CASING_WIDTH_EXTRA).toBeLessThanOrEqual(10);
    const core = routeLineWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "drive");
    const casing = routeCasingWidthByZoom(ROUTE_ACTIVE_LINE_WIDTH, "drive");
    expect(casing[0]).toBe("+");
    expect(casing[1]).toEqual(core);
    expect(extraAtZoom(routeCasingExtraByZoom(), 16)).toBe(ROUTE_LINE_CASING_WIDTH_EXTRA);
    expect(extraAtZoom(routeCasingExtraByZoom(), 10) as number).toBeLessThan(
      ROUTE_LINE_CASING_WIDTH_EXTRA
    );
  });
});

/** Rough perceived brightness, enough to prove "darker" without a color library. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("routeMapLineStyle", () => {
  it("uses a darker blue for the active line and a lighter one for the alternate", () => {
    const active = routeMapLineStyle(true);
    const alt = routeMapLineStyle(false);
    expect(active.color).toBe("#0ea5e9");
    expect(alt.color).toBe("#7dd3fc");
    expect(alt.color).not.toBe(active.color);
    /* The alternate must stay clearly lighter or A and B read as one line. */
    expect(luminance(alt.color)).toBeGreaterThan(luminance(active.color));
  });

  /* Sep 16 field test: both lines washed out in daylight. */
  it("keeps both lines darker than the pre-field-test pair", () => {
    expect(luminance(routeMapLineStyle(true).color)).toBeLessThan(luminance("#38bdf8"));
    expect(luminance(routeMapLineStyle(false).color)).toBeLessThan(luminance("#bae6fd"));
  });
});
