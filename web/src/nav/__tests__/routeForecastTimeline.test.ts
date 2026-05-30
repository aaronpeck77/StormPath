import { describe, expect, it } from "vitest";
import {
  buildRouteOutlookTimeline,
  precipBarHeight,
  routeOutlookAriaLabel,
} from "../routeForecastTimeline";

describe("buildRouteOutlookTimeline", () => {
  it("parses quarter-style forecast headlines into five stops", () => {
    const headline =
      "Start: 77°F overcast clouds → Quarter (in ~1 hr 21 min): 76°F light rain 58% precip → Midway (in ~2 hr 40 min): 74°F rain 72% precip → 3/4 mark (in ~4 hr): 72°F clouds → Destination: 71°F clear sky";
    const steps = buildRouteOutlookTimeline(headline);
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.shortLabel)).toEqual(["Go", "¼", "Mid", "¾", "End"]);
    expect(steps[0]?.tempF).toBe(77);
    expect(steps[1]?.precipPct).toBe(58);
    expect(steps[1]?.etaLabel).toBe("1 hr 21 min");
    expect(steps[1]?.icon).toBe("🌧");
  });

  it("falls back to weather samples when headline is not segmented", () => {
    const steps = buildRouteOutlookTimeline("clear sky; clouds 20%", [
      { t: 0, headline: "72°F clear sky; clouds 10%", precipHint: 0.1 },
      { t: 0.5, headline: "68°F light rain; clouds 80%", precipHint: 0.72 },
      { t: 1, headline: "70°F overcast clouds; clouds 90%", precipHint: 0.55 },
    ]);
    expect(steps).toHaveLength(5);
    expect(steps[2]?.conditions).toMatch(/rain/i);
    expect(precipBarHeight(steps[2]!)).toBeGreaterThan(40);
  });

  it("builds an accessible summary line", () => {
    const steps = buildRouteOutlookTimeline(
      "Start: 70°F clear → Destination: 65°F rain 40% precip"
    );
    const aria = routeOutlookAriaLabel(steps);
    expect(aria).toContain("Go");
    expect(aria).toContain("End");
    expect(aria).toContain("70°F");
  });
});
