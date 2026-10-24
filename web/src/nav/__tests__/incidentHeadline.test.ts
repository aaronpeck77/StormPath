import { describe, expect, it } from "vitest";
import { incidentDriverHeadline } from "../routeImpacts";

describe("incidentDriverHeadline", () => {
  it("names the accident instead of major impact", () => {
    expect(
      incidentDriverHeadline(
        {
          type: "accident",
          description: "Stalled truck in the right lane.",
          affectedRoadNames: ["I-72"],
        },
        false
      )
    ).toBe("Accident ahead — Stalled truck in the right lane on I-72");
  });

  it("uses the description when the type is only incident", () => {
    expect(
      incidentDriverHeadline(
        {
          type: "miscellaneous",
          description: "Debris in the roadway",
        },
        false
      )
    ).toBe("Debris in the roadway");
  });

  it("does not repeat a vague major-incident sentence", () => {
    expect(
      incidentDriverHeadline(
        {
          type: "incident",
          description: "There is a major incident ahead",
        },
        false
      )
    ).toBe("Incident ahead");
  });

  it("names a closure on the road", () => {
    expect(
      incidentDriverHeadline(
        {
          type: "road_closure",
          description: "All lanes closed after a crash",
          affectedRoadNames: ["US-36"],
        },
        true
      )
    ).toBe("Closure ahead — All lanes closed after a crash on US-36");
  });
});
