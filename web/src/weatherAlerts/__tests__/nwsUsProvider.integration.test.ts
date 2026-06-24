import { describe, expect, it } from "vitest";
import { NWS_REQUEST_USER_AGENT } from "../../config/nwsUserAgent";
import {
  fetchNwsAlertsForBrowseViewport,
  fetchNwsAlertsForRouteCorridor,
  nwsBrowseBoundsAroundLngLat,
} from "../nwsUsProvider";

describe("nwsUsProvider integration", () => {
  it("fetches national active alerts for an Illinois route corridor", async () => {
    const route: [number, number][] = [
      [-88.8, 39.78],
      [-89.0, 40.0],
      [-87.9, 41.5],
    ];
    const result = await fetchNwsAlertsForRouteCorridor(route, NWS_REQUEST_USER_AGENT);
    expect(result.alerts.length).toBeGreaterThan(0);
    expect(result.mapGeoJson.features.length).toBeGreaterThan(0);
  }, 60_000);

  it("fetches browse viewport alerts around Mount Zion IL", async () => {
    const bounds = nwsBrowseBoundsAroundLngLat(-88.8, 39.78);
    const result = await fetchNwsAlertsForBrowseViewport(bounds, NWS_REQUEST_USER_AGENT);
    expect(result.alerts.length).toBeGreaterThan(0);
  }, 60_000);
});
