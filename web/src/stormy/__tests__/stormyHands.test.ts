import { describe, expect, it } from "vitest";
import { interpretStormyRequest } from "../stormyHands";
import type { StormyPacket } from "../stormyFence";

const packet: StormyPacket = {
  aheadLine: "Light rain.",
  hazards: [],
  routes: [
    { id: "a", label: "A", summary: "20 min" },
    { id: "b", label: "B", summary: "25 min" },
  ],
  driving: false,
  turnImminent: false,
  question: "",
  weather: [],
  traffic: [],
  roads: [],
};

describe("interpretStormyRequest", () => {
  it("sends her to a named place and leaves", () => {
    expect(interpretStormyRequest("Take me to O'Hare", packet)).toMatchObject({
      action: "go_to",
      place: "O'Hare",
      drive: true,
    });
  });

  it("plans a route without starting the drive", () => {
    expect(interpretStormyRequest("Plan a route to O'Hare", packet)).toMatchObject({
      action: "go_to",
      place: "O'Hare",
      drive: false,
    });
  });

  it("starts the drive she already planned", () => {
    expect(interpretStormyRequest("Let's go", packet)?.action).toBe("start_drive");
  });

  it("picks a listed route by letter", () => {
    expect(interpretStormyRequest("Take route B", packet)).toMatchObject({
      action: "use_route",
      routeId: "b",
    });
  });

  it("stays out of it when a turn is coming", () => {
    expect(interpretStormyRequest("Take me to O'Hare", { ...packet, turnImminent: true })).toBeNull();
  });

  it("leaves ordinary questions for the model", () => {
    expect(interpretStormyRequest("What's ahead?", packet)).toBeNull();
  });
});
