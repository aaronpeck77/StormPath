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
  destination: "",
  eta: "",
  milesLeft: "",
  stops: [],
  here: "",
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

  it("tells him where to get a more natural voice", () => {
    const reply = interpretStormyRequest("Can you use a more natural voice?", packet);
    expect(reply?.action).toBe("none");
    expect(reply?.say).toContain("Ava or Zoe");
    expect(reply?.say).toContain("It's free");
  });

  it("reads the local forecast", () => {
    expect(interpretStormyRequest("What's my local forecast?", packet)?.say).toContain("72°F");
  });

  it("keeps the brand when adding a gas stop", () => {
    expect(interpretStormyRequest("Add a Casey gas station", { ...packet, destination: "Decatur" })).toMatchObject({
      action: "go_to",
      stop: true,
      place: "Casey gas station",
    });
  });

  it("adds coffee as a stop once a trip is going", () => {
    expect(interpretStormyRequest("Find me a place to get a coffee", { ...packet, driving: true })).toMatchObject({
      action: "go_to",
      place: "coffee",
      stop: true,
    });
  });

  it("talks through the trip instead of handing it off", () => {
    const reply = interpretStormyRequest("How's the trip?", {
      ...packet,
      destination: "Decatur",
      eta: "42 minutes",
      weather: ["Rain for the next 20 miles."],
    });
    expect(reply?.say).toContain("Decatur");
    expect(reply?.say).toContain("42 minutes");
    expect(reply?.action).toBe("explain_ahead");
  });

  it("leaves a worry for the model", () => {
    expect(interpretStormyRequest("Should I be worried?", packet)).toBeNull();
  });
});
