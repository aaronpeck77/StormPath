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
  forecast: "72°F and clear",
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

  it("still sets a place while a turn is close", () => {
    expect(interpretStormyRequest("Take me to O'Hare", { ...packet, turnImminent: true })).toMatchObject({
      action: "go_to",
      place: "O'Hare",
    });
  });

  it("sets a destination from a normal sentence and can leave", () => {
    expect(interpretStormyRequest("Can you set a destination to Chicago and hit go", packet)).toMatchObject({
      action: "go_to",
      place: "Chicago",
      drive: true,
    });
  });

  it("asks where when no place was named", () => {
    expect(interpretStormyRequest("Set a destination for me", packet)).toMatchObject({
      say: "Where do you want to go?",
      clarify: "place",
    });
  });

  it("hits go and stops a route", () => {
    expect(interpretStormyRequest("Hit go for me", packet)?.action).toBe("start_drive");
    expect(interpretStormyRequest("Stop the route", { ...packet, driving: true })?.action).toBe("end_trip");
  });

  it("reads the local forecast", () => {
    expect(interpretStormyRequest("What's my local forecast?", packet)?.say).toContain("72°F");
  });

  it("leaves ordinary questions for the model", () => {
    expect(interpretStormyRequest("What's ahead?", packet)).toBeNull();
  });
});
