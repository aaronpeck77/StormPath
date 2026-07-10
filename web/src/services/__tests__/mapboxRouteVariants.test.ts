import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/fetchResilient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/fetchResilient")>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
  };
});

import { fetchWithTimeout } from "../../utils/fetchResilient";
import { collectMapboxRouteVariants } from "../mapboxDirectionsRouter";
import type { LngLat } from "../../nav/types";

const start: LngLat = [-90.2, 38.63];
const end: LngLat = [-89.65, 39.78];

function lineCoords(lngShift = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    out.push([start[0] + (end[0] - start[0]) * t + lngShift, start[1] + (end[1] - start[1]) * t]);
  }
  return out;
}

function mbRoute(coords: [number, number][], duration: number, distance: number) {
  return {
    duration,
    distance,
    geometry: { type: "LineString" as const, coordinates: coords },
    legs: [
      {
        steps: [
          {
            geometry: { type: "LineString" as const, coordinates: coords },
            maneuver: { type: "depart", instruction: "Head out", location: coords[0] },
            name: "Main St",
            duration: duration / 2,
            distance: distance / 2,
          },
          {
            geometry: {
              type: "LineString" as const,
              coordinates: coords.slice(Math.floor(coords.length / 2)),
            },
            maneuver: {
              type: "arrive",
              instruction: "Arrive",
              location: coords[coords.length - 1],
            },
            name: "",
            duration: duration / 2,
            distance: distance / 2,
          },
        ],
      },
    ],
  };
}

function okResponse(routes: ReturnType<typeof mbRoute>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: "Ok", routes }),
  } as Response;
}

describe("collectMapboxRouteVariants", () => {
  afterEach(() => {
    vi.mocked(fetchWithTimeout).mockReset();
  });

  it("keeps a no-interstate B when primary Mapbox returns only Main", async () => {
    const main = mbRoute(lineCoords(0), 3600, 120_000);
    const noMw = mbRoute(lineCoords(-0.35), 4200, 135_000);

    vi.mocked(fetchWithTimeout).mockImplementation(async ({ input }) => {
      const url = String(input);
      if (url.includes("exclude=motorway")) {
        return okResponse([noMw]);
      }
      return okResponse([main]);
    });

    const routes = await collectMapboxRouteVariants("tok", start, end, {
      preferThreeRoutes: true,
      allowLocalTripThirdRoute: true,
      includeDetails: true,
    });

    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes[0]!.label).toBe("Main");
    expect(routes[1]!.label).toBe("No interstate");
  });

  it("keeps Mapbox primary alternate even when corridors mostly overlap", async () => {
    const main = mbRoute(lineCoords(0), 3600, 120_000);
    /* Slightly shifted + different ETA so Mapbox would still return it as alt #2. */
    const alt = mbRoute(lineCoords(-0.02), 3720, 122_000);

    vi.mocked(fetchWithTimeout).mockImplementation(async ({ input }) => {
      const url = String(input);
      if (url.includes("exclude=motorway")) {
        return okResponse([main]);
      }
      return okResponse([main, alt]);
    });

    const routes = await collectMapboxRouteVariants("tok", start, end, {
      preferThreeRoutes: true,
      allowLocalTripThirdRoute: true,
    });

    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes.some((r) => r.id === "r-b")).toBe(true);
  });
});
