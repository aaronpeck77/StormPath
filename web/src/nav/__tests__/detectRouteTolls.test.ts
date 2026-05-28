import { describe, expect, it } from "vitest";
import { detectRouteTollsFromLegs, type TollDetectLeg } from "../detectRouteTolls";

describe("detectRouteTollsFromLegs", () => {
  it("returns no tolls for an empty input", () => {
    expect(detectRouteTollsFromLegs(undefined)).toEqual({ hasTolls: false, tollLabels: [] });
    expect(detectRouteTollsFromLegs([])).toEqual({ hasTolls: false, tollLabels: [] });
  });

  it("ignores legs without toll classes or collection points", () => {
    const legs: TollDetectLeg[] = [
      { steps: [{ ref: "I-65", intersections: [{ classes: ["motorway"] }] }] },
      { steps: [{ name: "Local Road" }] },
    ];
    expect(detectRouteTollsFromLegs(legs)).toEqual({ hasTolls: false, tollLabels: [] });
  });

  it("flags tolls when a step intersection has the `toll` class", () => {
    const legs: TollDetectLeg[] = [
      {
        steps: [
          {
            ref: "I-90",
            name: "Indiana Toll Road",
            intersections: [{ classes: ["toll", "motorway"] }],
          },
        ],
      },
    ];
    const out = detectRouteTollsFromLegs(legs);
    expect(out.hasTolls).toBe(true);
    /* `ref` wins over `name` when both are present. */
    expect(out.tollLabels).toEqual(["I-90"]);
  });

  it("falls back to `name` when `ref` is missing on a tolled step", () => {
    const legs: TollDetectLeg[] = [
      {
        steps: [
          {
            name: "Chicago Skyway",
            intersections: [{ classes: ["toll"] }],
          },
        ],
      },
    ];
    expect(detectRouteTollsFromLegs(legs)).toEqual({
      hasTolls: true,
      tollLabels: ["Chicago Skyway"],
    });
  });

  it("captures named toll collection points", () => {
    const legs: TollDetectLeg[] = [
      {
        steps: [
          {
            ref: "I-294",
            intersections: [
              {
                toll_collection: { name: "Cline Avenue Plaza", type: "toll_booth" },
              },
            ],
          },
        ],
      },
    ];
    /* Named booth is preferred over the step `ref` to give the driver something locatable. */
    expect(detectRouteTollsFromLegs(legs)).toEqual({
      hasTolls: true,
      tollLabels: ["Cline Avenue Plaza"],
    });
  });

  it("falls back to step ref/name for unnamed booth/gantry", () => {
    const legs: TollDetectLeg[] = [
      {
        steps: [
          {
            ref: "OK-44",
            intersections: [{ toll_collection: { type: "toll_gantry" } }],
          },
        ],
      },
    ];
    expect(detectRouteTollsFromLegs(legs)).toEqual({
      hasTolls: true,
      tollLabels: ["OK-44"],
    });
  });

  it("deduplicates labels and caps the list at 8 entries", () => {
    /* 12 distinct refs all flagged as `toll`; output should keep insertion order and truncate. */
    const legs: TollDetectLeg[] = [
      {
        steps: Array.from({ length: 12 }, (_, i) => ({
          ref: `T${i}`,
          intersections: [{ classes: ["toll"] }],
          /* Repeat each ref to prove dedupe. */
        })),
      },
      {
        steps: Array.from({ length: 12 }, (_, i) => ({
          ref: `T${i}`,
          intersections: [{ classes: ["toll"] }],
        })),
      },
    ];
    const out = detectRouteTollsFromLegs(legs);
    expect(out.hasTolls).toBe(true);
    expect(out.tollLabels).toHaveLength(8);
    expect(out.tollLabels).toEqual(["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7"]);
  });

  it("treats whitespace-only refs/names as missing", () => {
    const legs: TollDetectLeg[] = [
      {
        steps: [
          {
            ref: "   ",
            name: "  ",
            intersections: [{ classes: ["toll"] }],
          },
        ],
      },
    ];
    /* `hasTolls` still flips, but no label can be derived from blank strings. */
    const out = detectRouteTollsFromLegs(legs);
    expect(out.hasTolls).toBe(true);
    expect(out.tollLabels).toEqual([]);
  });
});
