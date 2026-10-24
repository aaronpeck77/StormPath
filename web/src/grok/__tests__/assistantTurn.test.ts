import { describe, expect, it } from "vitest";
import { fallbackSpeech } from "../assistantTurn";

describe("assistant fallback", () => {
  it("lets the phone script speak only when no assistant is connected", () => {
    expect(fallbackSpeech("", "Traffic is clear on this route.")).toBe("Traffic is clear on this route.");
    expect(fallbackSpeech("   ", "About 20 minutes left.")).toBe("About 20 minutes left.");
  });

  it("does not let the phone script answer once Grok is connected", () => {
    expect(fallbackSpeech("K7MQ2P", "Traffic is clear on this route.")).toBeNull();
    expect(fallbackSpeech("K7MQ2P", "Ask your assistant about the weather and the road.")).toBeNull();
    expect(fallbackSpeech("K7MQ2P", "")).toBeNull();
  });
});
