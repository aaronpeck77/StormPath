import { describe, expect, it } from "vitest";
import {
  acceptStormyPacket,
  clampStormyReply,
  parseStormyModelText,
  STORMY_MAX_SAY_CHARS,
} from "../stormyFence";

const packet = {
  aheadLine: "Light rain for the next 6 miles.",
  hazards: ["Flood warning near mile 12"],
  routes: [
    { id: "a", label: "A", summary: "Fastest, 42 min" },
    { id: "b", label: "B", summary: "Avoids the flood, 51 min" },
  ],
  driving: true,
  turnImminent: false,
  question: "What's ahead?",
};

describe("acceptStormyPacket", () => {
  it("keeps the trip facts and drops anything else", () => {
    const result = acceptStormyPacket({ ...packet, dinner: "tacos", notes: "x".repeat(9000) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.aheadLine).toBe(packet.aheadLine);
    expect(result.packet.routes).toHaveLength(2);
    expect(result.packet).not.toHaveProperty("dinner");
  });

  it("refuses a packet with too many routes", () => {
    const result = acceptStormyPacket({
      ...packet,
      routes: [1, 2, 3, 4].map((n) => ({ id: String(n), label: String(n), summary: "ok" })),
    });
    expect(result).toEqual({ ok: false, error: "That trip packet is too big." });
  });
});

describe("clampStormyReply", () => {
  it("stays silent when a turn is coming", () => {
    expect(
      clampStormyReply(
        { say: "Heavy rain ahead.", action: "explain_ahead" },
        { ...packet, turnImminent: true }
      )
    ).toEqual({ say: "", action: "none", needsYes: false });
  });

  it("asks before offering another route", () => {
    expect(
      clampStormyReply({ say: "Route B avoids the flood.", action: "offer_alternate" }, packet)
    ).toEqual({
      say: "Route B avoids the flood.",
      action: "offer_alternate",
      needsYes: true,
    });
  });

  it("will not offer an alternate when only one route is in the packet", () => {
    const reply = clampStormyReply(
      { say: "Take the secret road.", action: "offer_alternate" },
      { ...packet, routes: packet.routes.slice(0, 1) }
    );
    expect(reply.action).toBe("explain_ahead");
    expect(reply.needsYes).toBe(false);
  });

  it("clears speech when she is told to be quiet", () => {
    expect(clampStormyReply({ say: "Still talking.", action: "quiet" }, packet)).toEqual({
      say: "",
      action: "quiet",
      needsYes: false,
    });
  });

  it("cuts a monologue down to a spoken length", () => {
    const say = `${"Rain. ".repeat(80)}Then more rain.`;
    const reply = clampStormyReply({ say, action: "explain_ahead" }, packet);
    expect(reply.say.length).toBeLessThanOrEqual(STORMY_MAX_SAY_CHARS);
    expect(reply.say.endsWith(".")).toBe(true);
  });
});

describe("parseStormyModelText", () => {
  it("reads JSON wrapped in a fence", () => {
    expect(parseStormyModelText('```json\n{"say":"Rain ahead.","action":"explain_ahead"}\n```')).toEqual({
      say: "Rain ahead.",
      action: "explain_ahead",
    });
  });
});
