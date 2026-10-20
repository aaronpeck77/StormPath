import { describe, expect, it } from "vitest";
import { replyTextFromXai, xaiRequestBody } from "../xaiReply";

describe("xai reply", () => {
  it("lets Grok use the web and answer normally", () => {
    const body = xaiRequestBody("The driver said: how's the road?");
    expect(body.model).toBe("grok-4.7");
    expect(body.search_parameters.mode).toBe("auto");
    expect(body.instructions).toContain("use the web");
    expect(body.input).toContain("how's the road");
  });

  it("reads the spoken line and ignores empty output", () => {
    expect(
      replyTextFromXai({
        output: [{ content: [{ type: "output_text", text: "Clear for the next hour." }] }],
      })
    ).toBe("Clear for the next hour.");
    expect(replyTextFromXai({ output: [] })).toBe("");
  });
});
