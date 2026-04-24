import type { LngLat, RouteTurnStep, TripPlan } from "./types";

export const EMPTY_TRIP: TripPlan = {
  originLabel: "Your location",
  destinationLabel: "Tap the map or search below",
  routes: [],
};

/** Two curved polylines when no Mapbox token (demo routing) */
export function buildMockTripBetween(
  start: LngLat,
  end: LngLat,
  destinationLabel: string
): TripPlan {
  const n = 32;
  const base: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const lng = start[0] + (end[0] - start[0]) * t;
    const lat = start[1] + (end[1] - start[1]) * t;
    const bend = Math.sin(t * Math.PI) * 0.004;
    base.push([lng + bend * (i % 2 === 0 ? 1 : -0.5), lat + bend * 0.3]);
  }

  const offset = (coords: LngLat[], dLng: number, dLat: number): LngLat[] =>
    coords.map(([lng, lat]) => [lng + dLng, lat + dLat]);

  const dist = Math.hypot(end[0] - start[0], end[1] - start[1]) * 50;
  const baseMin = Math.max(8, Math.min(55, Math.round(dist)));

  const mockSteps = (label: string): RouteTurnStep[] => [
    {
      instruction: `Follow ${label} on the map toward your destination`,
      distanceM: undefined,
      type: 6,
    },
    {
      instruction: "Arrive at destination",
      distanceM: undefined,
      type: 10,
    },
  ];

  return {
    originLabel: "Your location",
    destinationLabel,
    routes: [
      {
        id: "r-a",
        role: "fastest",
        label: "Main",
        geometry: offset(base, 0.0009, -0.00035),
        baseEtaMinutes: baseMin,
        turnSteps: mockSteps("Main"),
      },
      {
        id: "r-b",
        role: "hazardSmart",
        label: "No interstate",
        geometry: offset(base, -0.0011, 0.00055),
        baseEtaMinutes: baseMin + 3,
        turnSteps: mockSteps("No interstate"),
      },
      {
        id: "r-c",
        role: "balanced",
        label: "Scenic",
        geometry: offset(base, 0.0002, 0.001),
        baseEtaMinutes: baseMin + 1,
        turnSteps: mockSteps("Scenic"),
      },
    ],
  };
}
