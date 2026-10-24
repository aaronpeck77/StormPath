import { describe, expect, it } from "vitest";
import {
  centerPuttingPuckAtScreenPoint,
  driveYardLineAnchorPx,
  yardLineCorrectionIsSane,
  YARD_LINE_CORRECTION_MAX_M,
} from "../driveFollowCamAnchor";

/**
 * A pitched pinhole camera, because the whole point of this module is that a pitched
 * projection is *not* linear in screen pixels. Flat-earth ground plane, bearing 0
 * (north up), which is enough to pin the along-track arithmetic that was wrong.
 */
const VIEW_W = 844;
const VIEW_H = 390;
const MID = { x: VIEW_W / 2, y: VIEW_H / 2 };
const PITCH_DEG = 68;
/** Focal length in px for Mapbox's default fov at this viewport height. */
const FOCAL_PX = 586;
/** Camera height above ground, in the same ground units as the distances below. */
const CAM_H = 220;
const GROUND_PX_TO_M = 1.21;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 85_300; // ~lat 40

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Ground distance from the camera nadir for a screen row, in metres. */
function alongMetersAtScreenY(screenY: number): number {
  const upPx = MID.y - screenY;
  const phi = Math.atan(upPx / FOCAL_PX);
  return CAM_H * Math.tan(toRad(PITCH_DEG) + phi) * GROUND_PX_TO_M;
}

const CENTER_ALONG_M = alongMetersAtScreenY(MID.y);

function makeUnproject(center: [number, number]) {
  return ([x, y]: [number, number]): { lng: number; lat: number } => {
    const northM = alongMetersAtScreenY(y) - CENTER_ALONG_M;
    return {
      lng: center[0] + ((x - MID.x) * GROUND_PX_TO_M) / M_PER_DEG_LNG,
      lat: center[1] + northM / M_PER_DEG_LAT,
    };
  };
}

/** Landscape, right-hand UI: asymmetric padding plus the yard-line offset. */
const LANDSCAPE_PADDING = { top: 52, bottom: 48, left: 72, right: 430 };
const LANDSCAPE_OFFSET = [10, 72] as const;

describe("driveYardLineAnchorPx", () => {
  it("puts the puck near the 30-yard line (≈30% up from the bottom)", () => {
    const anchor = driveYardLineAnchorPx({
      mapWidth: VIEW_W,
      mapHeight: VIEW_H,
      padding: LANDSCAPE_PADDING,
      offset: LANDSCAPE_OFFSET,
    });
    expect(anchor).not.toBeNull();
    const upFromBottom = (VIEW_H - anchor!.y) / VIEW_H;
    expect(upFromBottom).toBeGreaterThan(0.25);
    expect(upFromBottom).toBeLessThan(0.36);
  });

  it("returns null for a collapsed container", () => {
    expect(
      driveYardLineAnchorPx({
        mapWidth: 0,
        mapHeight: VIEW_H,
        padding: LANDSCAPE_PADDING,
        offset: LANDSCAPE_OFFSET,
      })
    ).toBeNull();
  });
});

describe("centerPuttingPuckAtScreenPoint", () => {
  const puck: [number, number] = [-88.95, 39.84];
  const anchor = driveYardLineAnchorPx({
    mapWidth: VIEW_W,
    mapHeight: VIEW_H,
    padding: LANDSCAPE_PADDING,
    offset: LANDSCAPE_OFFSET,
  })!;

  /**
   * The exact answer: the camera center must sit ahead of the puck by the ground
   * distance between the anchor row and the center row.
   */
  const requiredAheadM = CENTER_ALONG_M - alongMetersAtScreenY(anchor.y);

  it("solves the along-track shift exactly under pitch", () => {
    const next = centerPuttingPuckAtScreenPoint({
      unproject: makeUnproject(puck),
      center: puck,
      puck,
      anchor,
    });
    expect(next).not.toBeNull();
    const aheadM = (next![1] - puck[1]) * M_PER_DEG_LAT;
    /* Ahead of the puck, so the puck falls back to the yard line. */
    expect(aheadM).toBeGreaterThan(0);
    expect(aheadM).toBeCloseTo(requiredAheadM, 0);
  });

  it("does not overshoot the way reflecting screen pixels did", () => {
    /* The shipped bug: reflect the anchor across the center in pixels, then
     * unproject. At pitch 68 the row above center is much further out than the row
     * below, so this lands roughly twice as far ahead and threw the puck at the
     * bottom edge — then Jeff fought the same overshoot on every resync. */
    const unproject = makeUnproject(puck);
    const reflected = unproject([
      MID.x + (MID.x - anchor.x),
      MID.y + (MID.y - anchor.y),
    ]);
    const reflectedAheadM = (reflected.lat - puck[1]) * M_PER_DEG_LAT;
    expect(reflectedAheadM).toBeGreaterThan(requiredAheadM * 1.6);

    const next = centerPuttingPuckAtScreenPoint({
      unproject,
      center: puck,
      puck,
      anchor,
    });
    expect((next![1] - puck[1]) * M_PER_DEG_LAT).toBeLessThan(reflectedAheadM * 0.75);
  });

  it("carries the lateral half of asymmetric landscape padding", () => {
    const next = centerPuttingPuckAtScreenPoint({
      unproject: makeUnproject(puck),
      center: puck,
      puck,
      anchor,
    });
    /* Right-hand UI puts chrome over the right half, so the anchor sits left of canvas
     * middle. To draw the puck left of center the camera center must move the other
     * way — right of the puck. Getting this sign wrong is the half-block swing. */
    expect(next![0]).toBeGreaterThan(puck[0]);
    const lateralM = (next![0] - puck[0]) * M_PER_DEG_LNG;
    expect(lateralM).toBeCloseTo((MID.x - anchor.x) * GROUND_PX_TO_M, 0);
  });

  it("is a no-op shift when the anchor already is the center", () => {
    const next = centerPuttingPuckAtScreenPoint({
      unproject: makeUnproject(puck),
      center: puck,
      puck,
      anchor: MID,
    });
    expect(next![0]).toBeCloseTo(puck[0], 9);
    expect(next![1]).toBeCloseTo(puck[1], 9);
  });

  it("gives up when unproject throws or returns garbage", () => {
    expect(
      centerPuttingPuckAtScreenPoint({
        unproject: () => {
          throw new Error("style mid-teardown");
        },
        center: puck,
        puck,
        anchor,
      })
    ).toBeNull();
    expect(
      centerPuttingPuckAtScreenPoint({
        unproject: () => ({ lng: Number.NaN, lat: 39.84 }),
        center: puck,
        puck,
        anchor,
      })
    ).toBeNull();
    /* Near-horizon unproject can land off the world. */
    expect(
      centerPuttingPuckAtScreenPoint({
        unproject: () => ({ lng: -88.95, lat: 89.9 }),
        center: puck,
        puck,
        anchor,
      })
    ).toBeNull();
  });
});

describe("yardLineCorrectionIsSane", () => {
  const puck: [number, number] = [-88.95, 39.84];

  it("accepts a real yard-line correction and rejects a projection blow-up", () => {
    expect(yardLineCorrectionIsSane(puck, [-88.95, 39.8425])).toBe(true);
    expect(yardLineCorrectionIsSane(puck, [-88.95, 41.5])).toBe(false);
    expect(yardLineCorrectionIsSane(puck, [-88.95, 89.9])).toBe(false);
    expect(yardLineCorrectionIsSane(puck, [Number.NaN, 39.84])).toBe(false);
  });

  it("leaves room for the real shift at Drive zoom", () => {
    const requiredM = CENTER_ALONG_M - alongMetersAtScreenY(VIEW_H * 0.7);
    expect(YARD_LINE_CORRECTION_MAX_M).toBeGreaterThan(requiredM * 2);
  });
});
