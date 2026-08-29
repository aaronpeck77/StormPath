import { describe, expect, it } from "vitest";
import {
  createInitialTripState,
  processTripSample,
} from "../tripDetector";

describe("processTripSample with motion hints", () => {
  const here: [number, number] = [-88.9, 39.8];

  it("does not start a trip while Core Motion says on foot", () => {
    const idle = createInitialTripState(1_000);
    const { state, trip } = processTripSample(idle, 2_000, here, 3, "on_foot");
    expect(state.phase).toBe("idle");
    expect(trip).toBeNull();
  });

  it("starts sooner when automotive even if GPS speed is a bit low", () => {
    const idle = createInitialTripState(1_000);
    const { state } = processTripSample(idle, 2_000, here, 0.9, "automotive");
    expect(state.phase).toBe("active");
  });

  it("keeps an active trip alive when automotive and GPS speed is briefly null", () => {
    let s = createInitialTripState(1_000);
    s = processTripSample(s, 2_000, here, 5, "automotive").state;
    expect(s.phase).toBe("active");
    s = processTripSample(s, 10_000, here, null, "automotive").state;
    expect(s.phase).toBe("active");
    expect(s.slowSince).toBeNull();
  });
});
