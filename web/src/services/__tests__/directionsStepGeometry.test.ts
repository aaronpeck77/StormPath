import { describe, expect, it } from "vitest";
import { geometryFromDirectionsSteps } from "../mapboxDirectionsRouter";

describe("geometryFromDirectionsSteps", () => {
  it("concatenates per-step geometries and drops duplicate joints", () => {
    const merged = geometryFromDirectionsSteps({
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
      legs: [
        {
          steps: [
            {
              geometry: {
                type: "LineString",
                coordinates: [
                  [0, 0],
                  [0.25, 0.05],
                  [0.5, 0.1],
                ],
              },
            },
            {
              geometry: {
                type: "LineString",
                coordinates: [
                  [0.5, 0.1],
                  [0.75, 0.05],
                  [1, 0],
                ],
              },
            },
          ],
        },
      ],
    });

    expect(merged).toEqual([
      [0, 0],
      [0.25, 0.05],
      [0.5, 0.1],
      [0.75, 0.05],
      [1, 0],
    ]);
  });

  it("returns null when steps have no geometry", () => {
    expect(
      geometryFromDirectionsSteps({
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        legs: [{ steps: [{ maneuver: { instruction: "Turn" } }] }],
      })
    ).toBeNull();
  });
});
