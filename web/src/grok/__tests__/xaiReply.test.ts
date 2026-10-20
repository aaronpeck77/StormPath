import { describe, expect, it } from "vitest";
import { functionCallsFromXai, replyTextFromXai, xaiFollowUpBody, xaiRequestBody, xaiResponseId } from "../xaiReply";

describe("xai reply", () => {
  it("lets Grok use the web and answer normally", () => {
    const body = xaiRequestBody("The driver said: how's the road?");
    expect(body.model).toBe("grok-4.7");
    expect(body.search_parameters.mode).toBe("auto");
    expect(body.instructions).toContain("use the web");
    expect(body.instructions).toContain("add_stop");
    expect(body.tools.some((tool) => tool.name === "add_stop")).toBe(true);
    expect(body.input).toContain("how's the road");
  });

  it("reads a stop request and sends the tool result back", () => {
    const payload = {
      id: "resp_1",
      output: [
        { type: "web_search_call" },
        { type: "function_call", call_id: "call_1", name: "add_stop", arguments: "{\"place\":\"coffee\"}" },
      ],
    };
    expect(xaiResponseId(payload)).toBe("resp_1");
    expect(functionCallsFromXai(payload)).toEqual([
      { callId: "call_1", name: "add_stop", arguments: { place: "coffee" } },
    ]);
    const follow = xaiFollowUpBody("resp_1", [{ callId: "call_1", output: "measured" }]);
    expect(follow.previous_response_id).toBe("resp_1");
    expect(follow.input[0]?.call_id).toBe("call_1");
    expect(follow.input[0]?.output).toBe("measured");
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
