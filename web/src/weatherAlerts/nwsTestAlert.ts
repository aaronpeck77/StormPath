import type { NormalizedWeatherAlert } from "./types";

/** Dev-only: set to `true` to inject a fake NWS polygon over central Oklahoma. */
export const NWS_TEST_ALERT_ENABLED = false;

/**
 * Large box covering most of Oklahoma — any route through the state will hit it.
 * Also covers parts of north Texas / south Kansas so a wide range of test routes work.
 */
export const NWS_TEST_ALERT: NormalizedWeatherAlert = {
  id: "stormpath-test-polygon",
  regionCode: "US",
  providerId: "placeholder",
  headline: "StormPath test polygon (not from NWS)",
  event: "Severe Thunderstorm Warning",
  description:
    "Synthetic overlay for development. Set NWS_TEST_ALERT_ENABLED = false in nwsTestAlert.ts to disable.",
  severity: "Severe",
  urgency: "Immediate",
  certainty: "Observed",
  ends: null,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-103.0, 34.0],
        [-94.0, 34.0],
        [-94.0, 37.5],
        [-103.0, 37.5],
        [-103.0, 34.0],
      ],
    ],
  },
  areaDesc: "Oklahoma / N Texas / S Kansas (StormPath test box)",
  stormMotionDeg: 225,
  stormMotionMph: 35,
};
