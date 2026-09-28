import { describe, expect, it } from "vitest";
import { formatRouteAlertTiming } from "../routeAlertTiming";
import {
  buildRoutePlaceAnchors,
  locationWithPlace,
  placeReferencePhrase,
} from "../routePlaceReference";
import { placeNameFromDestinations } from "../turnInstructionShort";
import type { LngLat } from "../types";

describe("placeNameFromDestinations", () => {
  it("keeps a town and drops a shield", () => {
    expect(placeNameFromDestinations("Springfield; I-40 East")).toBe("Springfield");
    expect(placeNameFromDestinations("I-24 East")).toBeNull();
  });
});

describe("placeReferencePhrase", () => {
  const town: LngLat = [-86.78, 36.16];
  const northOfTown: LngLat = [-86.78, 36.25];

  it("says how far and which way from a town", () => {
    const phrase = placeReferencePhrase(northOfTown, [
      { lngLat: town, place: "Springfield", exitNumber: null },
    ]);
    expect(phrase).toMatch(/^\d+ mi north of Springfield$/);
  });

  it("uses a nearby exit instead of a farther town", () => {
    const phrase = placeReferencePhrase(northOfTown, [
      { lngLat: northOfTown, place: "Springfield", exitNumber: "48" },
      { lngLat: [-86.78, 35.9], place: "Nashville", exitNumber: null },
    ]);
    expect(phrase).toMatch(/Exit 48 toward Springfield/);
  });

  it("builds an exit anchor at the start of that step", () => {
    const geometry: LngLat[] = [
      [-86.78, 36.16],
      [-86.78, 36.4],
    ];
    const anchors = buildRoutePlaceAnchors(
      [
        { instruction: "Continue", distanceM: 5000, roadRef: "I-24" },
        { instruction: "Exit 48 · toward Springfield", distanceM: 400, exitNumber: "48", towardPlace: "Springfield" },
      ],
      geometry
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.exitNumber).toBe("48");
    expect(anchors[0]?.place).toBe("Springfield");
  });
});

describe("locationWithPlace", () => {
  it("keeps the miles-ahead line and adds one landmark", () => {
    expect(locationWithPlace("25 mi ahead", "8 mi north of Springfield")).toBe(
      "25 mi ahead · 8 mi north of Springfield"
    );
  });

  it("does not add a landmark to Now", () => {
    expect(locationWithPlace("Now", "8 mi north of Springfield")).toBe("Now");
  });

  it("shows on the alert timing line", () => {
    const timing = formatRouteAlertTiming({
      startMeters: 50_000,
      endMeters: 55_000,
      userAlongMeters: 10_000,
      totalMeters: 200_000,
      planEtaMinutes: 120,
      placePhrase: "8 mi north of Springfield",
      placeLabel: "Winter weather",
    });
    expect(timing.locationLine).toContain("ahead");
    expect(timing.locationLine).toContain("8 mi north of Springfield");
  });
});
