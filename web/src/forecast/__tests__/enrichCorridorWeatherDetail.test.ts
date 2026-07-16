import { describe, expect, it } from "vitest";
import { enrichCorridorWeatherDetail } from "../enrichCorridorWeatherDetail";
import type { RouteForecast } from "../../services/tomorrowIo";

describe("enrichCorridorWeatherDetail", () => {
  it("replaces dry-along-route when local nowcast mentions rain", () => {
    const out = enrichCorridorWeatherDetail({
      corridorWeatherDetail: "Dry along route",
      advisoryNowcastLine: "72° · Light rain",
      tioRouteForecast: null,
    });
    expect(out).toBe("Rain along route");
  });

  it("returns base when no forecast intervals", () => {
    expect(
      enrichCorridorWeatherDetail({
        corridorWeatherDetail: "Clear skies",
        advisoryNowcastLine: null,
        tioRouteForecast: { intervals: [] } as unknown as RouteForecast,
      })
    ).toBe("Clear skies");
  });
});
