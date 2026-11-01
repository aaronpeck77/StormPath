import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ state: {} as any }));
vi.mock("react", () => ({
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (value: unknown) => value,
  useEffect: (effect: () => unknown) => effect(),
}));
vi.mock("../../state/tripPlanStore", () => ({
  useTripPlanStore: Object.assign((select: (s: any) => unknown) => select(mock.state), { getState: () => mock.state }),
}));
import { useHazardBypass } from "../useHazardBypass";
import type { NavRoute } from "../types";

const route: NavRoute = {
  id: "r", label: "Route", role: "fastest", baseEtaMinutes: 20,
  geometry: [[0, 0], [1, 0]],
  turnSteps: [{ instruction: "Continue", roadRef: "I-55", distanceM: 20000 }],
};

function setup(isOnline = true, road = route) {
  const options = { route: road, alongMeters: 0, items: [], isOnline, metersToManeuver: 10000,
    computeRoutes: vi.fn().mockResolvedValue({ ok: true }),
    setFitTrigger: vi.fn(), setTapHint: vi.fn(), getRouteLine: () => route.geometry };
  return { options, bend: useHazardBypass(options) };
}

beforeEach(() => {
  mock.state = {
    navigationStarted: true, destLngLat: [1, 0], destinationLabel: "Home", viaStops: [], activeViaIndex: 0,
    setViaStops: vi.fn((vias) => { mock.state.viaStops = vias; }),
    setActiveViaIndex: vi.fn((index) => { mock.state.activeViaIndex = index; }),
    setViewMode: vi.fn(),
  };
});

describe("Bend session safeguards", () => {
  it("does not enter or calculate offline or on town streets", () => {
    const offline = setup(false);
    offline.bend.enter();
    expect(offline.options.setTapHint).toHaveBeenCalledWith(expect.stringContaining("needs a connection"));
    expect(mock.state.setViewMode).not.toHaveBeenCalled();
    const town = setup(true, { ...route, turnSteps: [{ instruction: "Continue", roadName: "Main St", distanceM: 20000 }] });
    town.bend.enter();
    expect(mock.state.setViewMode).not.toHaveBeenCalled();
  });

  it("ignores overlapping pulls and restores stops after a failed calculation", async () => {
    const { bend, options } = setup();
    let resolve!: (result: { ok: boolean; reason: string }) => void;
    options.computeRoutes.mockImplementation(() => new Promise((done) => { resolve = done; }));
    bend.enter();
    const first = bend.pull([0, 0], [0.5, 1]);
    await bend.pull([0, 0], [0.7, 1]);
    expect(options.computeRoutes).toHaveBeenCalledTimes(1);
    resolve({ ok: false, reason: "No connection" });
    await first;
    expect(mock.state.viaStops).toEqual([]);
    expect(mock.state.activeViaIndex).toBe(0);
  });

  it("keeps the route untouched if connectivity disappears during editing", async () => {
    const { bend, options } = setup();
    bend.enter();
    options.isOnline = false;
    await bend.pull([0, 0], [0.5, 1]);
    expect(options.computeRoutes).not.toHaveBeenCalled();
    expect(mock.state.setViaStops).not.toHaveBeenCalled();
  });
});
