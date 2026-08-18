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
      maxRoutes: 2,
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
      maxRoutes: 2,
    });

    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes.some((r) => r.id === "r-b")).toBe(true);
  });

  it("forces a Plus B by excluding a mid-corridor point when no-interstate matches Main", async () => {
    const main = mbRoute(lineCoords(0), 3600, 120_000);
    const alt = mbRoute(lineCoords(-0.35), 4200, 135_000);
    let pointExcludeCalls = 0;

    vi.mocked(fetchWithTimeout).mockImplementation(async ({ input }) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("point(")) {
        pointExcludeCalls += 1;
        return okResponse([alt]);
      }
      if (url.includes("exclude=motorway")) {
        return okResponse([main]);
      }
      return okResponse([main]);
    });

    const routes = await collectMapboxRouteVariants("tok", start, end, {
      maxRoutes: 2,
      includeDetails: true,
    });

    expect(pointExcludeCalls).toBeGreaterThanOrEqual(1);
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes[0]!.label).toBe("Main");
    expect(routes[1]!.id).toBe("r-b");
    expect(routes[1]!.label).toBe("Alternate");
  });

  it("encodes Mapbox point() excludes with %20, not +", async () => {
    const main = mbRoute(lineCoords(0), 3600, 120_000);
    const alt = mbRoute(lineCoords(-0.35), 4200, 135_000);
    const pointUrls: string[] = [];

    vi.mocked(fetchWithTimeout).mockImplementation(async ({ input }) => {
      const url = String(input);
      if (url.includes("point(") || url.includes("point%28")) {
        pointUrls.push(url);
        return okResponse([alt]);
      }
      return okResponse([main]);
    });

    await collectMapboxRouteVariants("tok", start, end, { maxRoutes: 2 });

    expect(pointUrls.length).toBeGreaterThanOrEqual(1);
    const raw = pointUrls[0]!;
    expect(raw).toMatch(/exclude=.*point/i);
    expect(raw).not.toMatch(/point\([^)]+\+/);
    expect(raw.includes("%20") || decodeURIComponent(raw).includes("point(")).toBe(true);
  });

  it("drops an identical primary alternate so a point-exclude B can run", async () => {
    const main = mbRoute(lineCoords(0), 3600, 120_000);
    const clone = mbRoute(lineCoords(0), 3610, 120_400);
    const alt = mbRoute(lineCoords(-0.35), 4200, 135_000);
    let pointExcludeCalls = 0;

    vi.mocked(fetchWithTimeout).mockImplementation(async ({ input }) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("point(")) {
        pointExcludeCalls += 1;
        return okResponse([alt]);
      }
      if (url.includes("exclude=motorway")) {
        return okResponse([main]);
      }
      return okResponse([main, clone]);
    });

    const routes = await collectMapboxRouteVariants("tok", start, end, { maxRoutes: 2 });

    expect(pointExcludeCalls).toBeGreaterThanOrEqual(1);
    expect(routes).toHaveLength(2);
    expect(routes[1]!.label).toBe("Alternate");
  });

  it("does not fetch a point-exclude B when Plus already has two distinct routes", async () => {
    const main = mbRoute(lineCoords(0), 3600, 120_000);
    const noMw = mbRoute(lineCoords(-0.35), 4200, 135_000);
    let pointExcludeCalls = 0;

    vi.mocked(fetchWithTimeout).mockImplementation(async ({ input }) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("point(")) {
        pointExcludeCalls += 1;
        return okResponse([noMw]);
      }
      if (url.includes("exclude=motorway")) {
        return okResponse([noMw]);
      }
      return okResponse([main]);
    });

    const routes = await collectMapboxRouteVariants("tok", start, end, { maxRoutes: 2 });

    expect(routes).toHaveLength(2);
    expect(routes[1]!.label).toBe("No interstate");
    expect(pointExcludeCalls).toBe(0);
  });

  it("Basic maxRoutes=1 uses a single Directions call and returns Main only", async () => {
    const main = mbRoute(lineCoords(0), 3600, 120_000);
    const noMw = mbRoute(lineCoords(-0.35), 4200, 135_000);
    let calls = 0;

    vi.mocked(fetchWithTimeout).mockImplementation(async ({ input }) => {
      calls += 1;
      const url = String(input);
      if (url.includes("exclude=motorway")) {
        return okResponse([noMw]);
      }
      return okResponse([main, noMw]);
    });

    const routes = await collectMapboxRouteVariants("tok", start, end, {
      maxRoutes: 1,
    });

    expect(routes).toHaveLength(1);
    expect(routes[0]!.label).toBe("Main");
    expect(calls).toBe(1);
  });
});
