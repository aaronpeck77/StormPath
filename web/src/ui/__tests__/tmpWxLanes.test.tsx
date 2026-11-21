import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { RouteWxLanes, wxLanesDebug } from "../RouteWxLanes";

describe("RouteWxLanes canvas render", () => {
  it("mounts 4 lanes with labels + canvases; reports point counts", () => {
    const steps = Array.from({ length: 5 }, (_, i) => ({
      fraction: i / 4,
      tempF: 60 + i * 3,
      precipPct: i === 4 ? 67 : 10,
      shortLabel: "x",
      etaLabel: "x",
      conditions: "rain",
      precipIntensityMmh: i === 4 ? 2 : 0,
      windGustMph: 20,
    })) as any;
    const html = renderToStaticMarkup(
      createElement(RouteWxLanes, {
        steps,
        radarSamples: [{ t: 0.8, intensity: 40 }],
        windPoints: [{ t: 0, mph: 12 }, { t: 0.5, mph: 18 }, { t: 1, mph: 9 }],
        gustLinePoints: [],
        gustSpikePoints: [],
        userAlongT: 0.1,
      })
    );
    for (const label of ["Temp", "Precip", "Radar", "Wind"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect((html.match(/<canvas/g) ?? []).length).toBe(4);
    expect(html).not.toContain("url(");
    // Series derivations produced paintable point sets
    expect(wxLanesDebug.temp).toBeGreaterThan(1);
    expect(wxLanesDebug.precip).toBeGreaterThan(1);
    expect(wxLanesDebug.wind).toBeGreaterThan(1);
  });
});
