import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../weatherKitAuth", () => ({
  fetchWeatherKitToken: vi.fn(async () => "tok"),
}));

vi.mock("../../utils/fetchResilient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/fetchResilient")>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
  };
});

import { fetchWithTimeout } from "../../utils/fetchResilient";
import {
  fetchWeatherKitAtPoint,
  resetWeatherKitClientCaches,
  weatherKitAlertPollKey,
  weatherKitLocationCell,
  weatherKitUsesPuckBundle,
} from "../weatherKitClient";

function okBody() {
  return {
    currentWeather: { temperature: 20, conditionCode: "Clear" },
    forecastHourly: { hours: [] },
    forecastDaily: { days: [] },
    forecastNextHour: { minutes: [] },
    weatherAlerts: { alerts: [] },
  };
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => okBody(),
    text: async () => "",
  } as Response;
}

describe("WeatherKit quota helpers", () => {
  it("uses a ~110 m cell so GPS wander does not miss cache", () => {
    expect(weatherKitLocationCell(38.63001, -90.20001)).toBe(
      weatherKitLocationCell(38.6304, -90.2004)
    );
  });

  it("keeps alert polls on a ~1 km grid", () => {
    expect(weatherKitAlertPollKey(38.631, -90.201)).toBe(weatherKitAlertPollKey(38.634, -90.204));
    expect(weatherKitAlertPollKey(38.63, -90.2)).not.toBe(weatherKitAlertPollKey(38.65, -90.2));
  });

  it("does not fold corridor hourly into the puck bundle", () => {
    expect(weatherKitUsesPuckBundle(["forecastHourly"])).toBe(false);
    expect(weatherKitUsesPuckBundle(["weatherAlerts"])).toBe(true);
    expect(weatherKitUsesPuckBundle(["currentWeather", "forecastNextHour"])).toBe(true);
  });
});

describe("fetchWeatherKitAtPoint", () => {
  afterEach(() => {
    resetWeatherKitClientCaches();
    vi.mocked(fetchWithTimeout).mockReset();
  });

  it("collapses puck nowcast + alerts + hourly into one Apple call", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(okResponse());

    await Promise.all([
      fetchWeatherKitAtPoint(38.63, -90.2, ["currentWeather"]),
      fetchWeatherKitAtPoint(38.63, -90.2, ["weatherAlerts"]),
      fetchWeatherKitAtPoint(38.63, -90.2, ["forecastHourly", "forecastDaily"]),
    ]);

    expect(vi.mocked(fetchWithTimeout).mock.calls).toHaveLength(1);
    const url = String(vi.mocked(fetchWithTimeout).mock.calls[0]![0].input);
    expect(url).toContain("currentWeather");
    expect(url).toContain("forecastHourly");
    expect(url).toContain("weatherAlerts");
    expect(url).toContain("country=US");
  });

  it("serves a later puck subset from cache without another Apple call", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(okResponse());
    await fetchWeatherKitAtPoint(38.63, -90.2, ["currentWeather"]);
    await fetchWeatherKitAtPoint(38.6302, -90.2002, ["forecastNextHour"]);
    expect(vi.mocked(fetchWithTimeout).mock.calls).toHaveLength(1);
  });

  it("keeps corridor hourly as its own request", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(okResponse());
    await fetchWeatherKitAtPoint(38.63, -90.2, ["forecastHourly"]);
    const url = String(vi.mocked(fetchWithTimeout).mock.calls[0]![0].input);
    expect(url).toContain("dataSets=forecastHourly");
    expect(url).not.toContain("weatherAlerts");
  });
});
