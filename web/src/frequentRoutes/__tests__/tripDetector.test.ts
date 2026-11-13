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

describe("processTripSample distance-based sampling", () => {
  const base: [number, number] = [-88.9, 39.8];
  /** ~111 m of latitude per 0.001° — clears the 100 m spacing target each tick. */
  const stepNorth = (i: number): [number, number] => [-88.9, 39.8 + i * 0.001];

  it("appends roughly every 100 m of travel, staying dense at highway speed", () => {
    let s = createInitialTripState(0);
    s = processTripSample(s, 2_000, base, 30).state;
    expect(s.phase).toBe("active");
    for (let i = 1; i <= 10; i++) {
      s = processTripSample(s, 2_000 + i * 4_000, stepNorth(i), 30).state;
    }
    // Old 16 s gate would keep ~3 points across 40 s of driving; distance rule
    // keeps ~one per tick at this spacing.
    expect(s.points.length).toBeGreaterThanOrEqual(10);
  });

  it("trims points appended during the final slow-down (parking wander)", () => {
    let s = createInitialTripState(0);
    let trip = null as ReturnType<typeof processTripSample>["trip"];
    s = processTripSample(s, 2_000, base, 30).state;
    // Drive ~1.1 km north.
    for (let i = 1; i <= 10; i++) {
      s = processTripSample(s, 2_000 + i * 4_000, stepNorth(i), 30).state;
    }
    const ptsAfterDrive = s.points.length;
    const driveEndLat = 39.8 + 10 * 0.001;
    // Parked: speed 0 but GPS wanders >100 m per tick — drift that would
    // otherwise append phantom tail points during the 45 s dwell.
    for (let i = 11; i <= 30 && !trip; i++) {
      const pos: [number, number] = [-88.9, driveEndLat + (i - 10) * 0.002];
      const r = processTripSample(s, 2_000 + i * 4_000, pos, 0);
      s = r.state;
      trip = r.trip;
    }
    expect(trip).not.toBeNull();
    const geom = trip!.geometry;
    // Trimmed back to the last driving fix — wander points never made the cut.
    expect(geom.length).toBe(ptsAfterDrive);
    expect(Math.abs(geom[geom.length - 1]![1] - driveEndLat)).toBeLessThan(0.0005);
  });

  it("does not trim points recorded after a mid-trip stop-and-go", () => {
    let s = createInitialTripState(0);
    let trip = null as ReturnType<typeof processTripSample>["trip"];
    s = processTripSample(s, 2_000, base, 30).state;
    const at = (lat: number) => [-88.9, lat] as [number, number];
    // Ticks 1-5: drive north to 39.805.
    for (let i = 1; i <= 5; i++) {
      s = processTripSample(s, 2_000 + i * 4_000, at(39.8 + i * 0.001), 30).state;
    }
    // Ticks 6-8: brief stop (~12 s < 45 s dwell), same position, speed 0.
    for (let i = 6; i <= 8; i++) {
      s = processTripSample(s, 2_000 + i * 4_000, at(39.805), 0).state;
    }
    expect(s.phase).toBe("active");
    // Ticks 9-16: resume, continuing north to ~39.813.
    for (let i = 9; i <= 16; i++) {
      s = processTripSample(s, 2_000 + i * 4_000, at(39.805 + (i - 8) * 0.001), 30).state;
    }
    // The brief stop cleared the slow marker — nothing gets trimmed later.
    expect(s.slowSince).toBeNull();
    expect(s.slowStartLen).toBeUndefined();
    const resumeEndLat = 39.805 + 8 * 0.001;
    // Park for good: dwell >45 s ends the trip.
    for (let i = 17; i <= 40 && !trip; i++) {
      const r = processTripSample(s, 2_000 + i * 4_000, at(resumeEndLat), 0);
      s = r.state;
      trip = r.trip;
    }
    expect(trip).not.toBeNull();
    const geom = trip!.geometry;
    // Post-stop driving points survive — only the final dwell tail is trimmed.
    expect(Math.abs(geom[geom.length - 1]![1] - resumeEndLat)).toBeLessThan(0.0005);
  });
});
