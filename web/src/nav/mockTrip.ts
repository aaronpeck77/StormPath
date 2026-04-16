import type { LngLat, TripPlan } from "./types";

/** Demo corridor: roughly north–south so radar/forecast copy reads naturally */
function buildCorridor(offsetLat: number): LngLat[] {
  const out: LngLat[] = [];
  const startLng = -94.62;
  const startLat = 39.02 + offsetLat;
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lng = startLng + t * 0.22;
    const lat = startLat + t * 0.16 + Math.sin(t * Math.PI * 2) * 0.012;
    out.push([lng, lat]);
  }
  return out;
}

export const MOCK_TRIP: TripPlan = {
  originLabel: "Current location",
  destinationLabel: "Destination (demo)",
  routes: [
    {
      id: "r-fast",
      role: "fastest",
      label: "Fastest",
      geometry: buildCorridor(0.035),
      baseEtaMinutes: 42,
    },
    {
      id: "r-mid",
      role: "balanced",
      label: "Balanced",
      geometry: buildCorridor(0),
      baseEtaMinutes: 45,
    },
    {
      id: "r-safe",
      role: "hazardSmart",
      label: "Hazard-smart",
      geometry: buildCorridor(-0.04),
      baseEtaMinutes: 48,
    },
  ],
};
