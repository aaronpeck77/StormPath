import type { NormalizedWeatherAlert } from "./types";

/** Dev-only: set to `true` to inject a fake NWS polygon over central Oklahoma. */
export const NWS_TEST_ALERT_ENABLED = false;

/**
 * Fixed box ~25×20 mi — plan any route segment through this area with storm advisory on to verify UI.
 * Roughly south of Oklahoma City (I-35 / US-77 corridor crosses this box).
 */
export const NWS_TEST_ALERT: NormalizedWeatherAlert = {
  id: "stormpath-test-polygon",
  regionCode: "US",
  providerId: "placeholder",
  headline: "StormPath test polygon (not from NWS)",
  event: "Test Warning (dev)",
  description:
    "Synthetic overlay for development. Set NWS_TEST_ALERT_ENABLED = false in nwsTestAlert.ts to disable.",
  severity: "Moderate",
  urgency: "Unknown",
  certainty: "Unknown",
  ends: null,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-97.55, 35.45],
        [-97.15, 35.45],
        [-97.15, 35.7],
        [-97.55, 35.7],
        [-97.55, 35.45],
      ],
    ],
  },
  areaDesc: "Central Oklahoma (StormPath test box)",
};
