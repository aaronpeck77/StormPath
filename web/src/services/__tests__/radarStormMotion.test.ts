import { describe, expect, it } from "vitest";
import {
  buildEchoGrid,
  estimateMotionByCrossCorrelation,
} from "../radarEchoCrossCorr";
import {
  computeRegionalStormMotion,
  formatRadarMotionLabel,
  matchStormPeakPairs,
  maxPlausibleShiftMeters,
  nwsStormMotionInBounds,
  RADAR_STORM_MAX_SPEED_MPH,
  type PeakCell,
  type RadarStormMotion,
} from "../radarStormMotion";
import { initialBearingDegrees } from "../../nav/routeGeometry";

const DT_10MIN = 600;
const DT_20MIN = 1200;

function peak(lng: number, lat: number, intensity: number): PeakCell {
  return { peakLng: lng, peakLat: lat, peak: intensity };
}

function synthEastboundGrid(
  west: number,
  south: number,
  cols: number,
  rows: number,
  cellDeg: number,
  shiftCols: number
) {
  const values = new Float32Array(cols * rows);
  const blobs = [
    { col: 8, row: 10, v: 0.85 },
    { col: 14, row: 10, v: 0.9 },
    { col: 20, row: 11, v: 0.82 },
    { col: 12, row: 6, v: 0.78 },
  ];
  for (const b of blobs) {
    const c = b.col + shiftCols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const col = c + dc;
        const row = b.row + dr;
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
        values[row * cols + col] = Math.max(values[row * cols + col]!, b.v * (dc === 0 && dr === 0 ? 1 : 0.88));
      }
    }
  }
  return { west, south, cellDeg, cols, rows, values };
}

describe("estimateMotionByCrossCorrelation", () => {
  it("detects eastbound bulk echo shift", () => {
    const cols = 28;
    const rows = 18;
    const cellDeg = 0.042;
    const west = -91;
    const south = 40.5;
    const older = synthEastboundGrid(west, south, cols, rows, cellDeg, 0);
    const newer = synthEastboundGrid(west, south, cols, rows, cellDeg, 3);

    const est = estimateMotionByCrossCorrelation(older, newer, DT_20MIN, RADAR_STORM_MAX_SPEED_MPH, 3500);
    expect(est).not.toBeNull();
    expect(est!.bearingDeg).toBeGreaterThan(70);
    expect(est!.bearingDeg).toBeLessThan(110);
    expect(est!.directionConfidence).toBeGreaterThan(0.52);
  });
});

describe("formatRadarMotionLabel", () => {
  it("shows direction only when speed is withheld", () => {
    const m: RadarStormMotion = {
      lng: -88,
      lat: 41,
      bearingDeg: 90,
      speedMph: null,
      intensity: 0.8,
      minutesToArrive: null,
    };
    expect(formatRadarMotionLabel(m)).toBe("→ E");
  });

  it("shows mph when speed is present", () => {
    const m: RadarStormMotion = {
      lng: -88,
      lat: 41,
      bearingDeg: 90,
      speedMph: 32,
      intensity: 0.8,
      minutesToArrive: null,
    };
    expect(formatRadarMotionLabel(m)).toBe("32 mph E");
  });
});

describe("nwsStormMotionInBounds", () => {
  it("returns StormMotion from overlapping alert", () => {
    const bounds = { west: -89, south: 40.5, east: -87.5, north: 42 };
    const alerts: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { motionDeg: 90, motionMph: 35 },
          geometry: {
            type: "Polygon",
            coordinates: [[[-90, 40], [-87, 40], [-87, 42.5], [-90, 42.5], [-90, 40]]],
          },
        },
      ],
    };
    const m = nwsStormMotionInBounds(alerts, bounds);
    expect(m).toEqual({ bearingDeg: 90, speedMph: 35 });
  });
});

describe("computeRegionalStormMotion", () => {
  it("tracks eastbound squall-line shift", () => {
    const older = [
      peak(-90.4, 41.6, 0.82),
      peak(-89.9, 41.6, 0.88),
      peak(-89.4, 41.6, 0.84),
    ];
    const newer = [
      peak(-90.28, 41.62, 0.83),
      peak(-89.78, 41.61, 0.87),
      peak(-89.28, 41.6, 0.85),
    ];
    const regional = computeRegionalStormMotion(older, newer, DT_20MIN);
    expect(regional).not.toBeNull();
    expect(regional!.bearingDeg).toBeGreaterThan(65);
    expect(regional!.bearingDeg).toBeLessThan(115);
  });
});

describe("maxPlausibleShiftMeters", () => {
  it("scales with frame interval and speed cap", () => {
    const m = maxPlausibleShiftMeters(DT_10MIN);
    const mph = (m / DT_10MIN) * 2.23694;
    expect(mph).toBeCloseTo(RADAR_STORM_MAX_SPEED_MPH, 0);
  });
});

describe("matchStormPeakPairs", () => {
  it("pairs eastbound storm with older echo to the west", () => {
    const newer = peak(-90.0, 40.0, 0.85);
    const olderWest = peak(-90.1, 40.0, 0.82);
    const olderEast = peak(-89.9, 40.0, 0.9);
    const pairs = matchStormPeakPairs([newer], [olderEast, olderWest], DT_10MIN);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.older.peakLng).toBeCloseTo(-90.1, 2);
    const bearing = initialBearingDegrees(
      [pairs[0]!.older.peakLng, pairs[0]!.older.peakLat],
      [pairs[0]!.newer.peakLng, pairs[0]!.newer.peakLat]
    );
    expect(bearing).toBeGreaterThan(70);
    expect(bearing).toBeLessThan(110);
  });
});

describe("buildEchoGrid", () => {
  it("fills cells from sampler", () => {
    const grid = buildEchoGrid(
      { west: -90, south: 40, east: -89, north: 41 },
      (lng) => (lng > -89.5 ? 0.7 : 0)
    );
    expect(grid.values.some((v) => v > 0.5)).toBe(true);
  });
});
