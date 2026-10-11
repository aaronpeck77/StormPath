import { describe, expect, it } from "vitest";
import { STORMY_MAX_SAY_CHARS, type StormyPacket } from "../stormyFence";
import {
  answerStormySituation,
  stormyFactsFromImpacts,
  stormyRoadRefs,
} from "../stormySituation";

const packet: StormyPacket = {
  aheadLine: "",
  hazards: [],
  routes: [
    { id: "a", label: "A", summary: "42 min" },
    { id: "b", label: "B", summary: "51 min" },
  ],
  driving: true,
  turnImminent: false,
  question: "",
  weather: ["Rain for the next 20 miles, 12 miles ahead."],
  traffic: ["Congestion ahead, on I-75, 8 miles ahead."],
  roads: ["I-75", "I-24"],
};

describe("stormyFactsFromImpacts", () => {
  it("splits weather and traffic and names the distance", () => {
    const facts = stormyFactsFromImpacts(
      [
        {
          category: "weather",
          driverHeadline: "Rain",
          roadEffect: "Steady rain on the route",
          distanceAheadMeters: 12 * 1609.344,
        },
        {
          category: "incident",
          driverHeadline: "Accident ahead",
          roadEffect: "on I-75",
          distanceAheadMeters: 8 * 1609.344,
        },
      ],
      true
    );
    expect(facts.weather[0]).toContain("12 miles ahead");
    expect(facts.traffic[0]).toContain("I-75");
    expect(facts.traffic[0]).toContain("8 miles ahead");
  });
});

describe("stormyRoadRefs", () => {
  it("keeps highway shields and drops side streets", () => {
    expect(
      stormyRoadRefs([
        { roadRef: "I 75", roadName: "Interstate 75" },
        { roadName: "Main Street" },
        { roadRef: "US-41" },
      ])
    ).toEqual(["I-75", "US-41"]);
  });
});

describe("answerStormySituation", () => {
  it("reads the weather already on the route", () => {
    const reply = answerStormySituation("What can we expect for weather on the route today?", packet);
    expect(reply?.action).toBe("explain_ahead");
    expect(reply?.say).toContain("Rain");
    expect(reply?.say.length).toBeLessThanOrEqual(STORMY_MAX_SAY_CHARS);
  });

  it("reads traffic on a highway that is on the route", () => {
    const reply = answerStormySituation("How does traffic look on I75?", packet);
    expect(reply?.say.toLowerCase()).toContain("i-75");
    expect(reply?.say.toLowerCase()).toContain("congestion");
    expect(reply?.action).not.toBe("use_route");
  });

  it("does not invent a highway that is not on the route", () => {
    const reply = answerStormySituation("How is traffic on I-65?", packet);
    expect(reply?.say).toBe("I-65 isn't on this route.");
    expect(reply?.say).not.toMatch(/congestion|clear/i);
  });

  it("says a highway on the route is clear when nothing is reported there", () => {
    const reply = answerStormySituation("How is I-24?", {
      ...packet,
      traffic: ["Accident ahead, on Main Street, right ahead."],
    });
    expect(reply?.say).toBe("I-24 is on our route, and it's clear.");
    expect(reply?.say).not.toContain("Main Street");
  });

  it("will not move the route around a backup", () => {
    const reply = answerStormySituation("Reroute around the traffic backup", packet);
    expect(reply?.action).toBe("explain_ahead");
    expect(reply?.say).toContain("Route B");
    expect(reply?.say.toLowerCase()).not.toContain("taking");
  });

  it("stays with the drive when asked for something else", () => {
    expect(answerStormySituation("What's for dinner?", packet)?.say).toBe("I'll stay with the drive.");
  });

  it("leaves an open trip question for the model", () => {
    expect(answerStormySituation("What's ahead?", packet)).toBeNull();
  });
});
