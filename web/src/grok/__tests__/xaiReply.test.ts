import { describe, expect, it } from "vitest";
import {
  assistantUsesWeb,
  functionCallsFromXai,
  replyTextFromXai,
  xaiFollowUpBody,
  xaiRequestBody,
  xaiResponseId,
} from "../xaiReply";

describe("xai reply", () => {
  it("lets Grok use the web and answer normally", () => {
    const body = xaiRequestBody("The driver said: how's the road?");
    expect(body.model).toBe("grok-4.7");
    expect(body).not.toHaveProperty("search_parameters");
    expect(body.instructions).toContain("use the web");
    expect(body.instructions).toContain("add_stop");
    expect(assistantUsesWeb("The driver said: how's the road?")).toBe(true);
    expect(body.tools.some((tool) => tool.type === "web_search")).toBe(true);
    expect(body.tools.some((tool) => tool.type === "function" && tool.name === "add_stop")).toBe(true);
    expect(body.input[0]?.content).toContain("how's the road");
  });

  it("answers a measured trip without searching the web", () => {
    const text = "The driver said: how's the weather. StormPath measured: Destination: Orlando.";
    const body = xaiRequestBody(text);
    expect(assistantUsesWeb(text)).toBe(false);
    expect(body.instructions).toContain("Do not search the web");
    expect(body.tools.some((tool) => tool.type === "web_search")).toBe(false);
    expect(body.tools.some((tool) => tool.type === "function" && tool.name === "read_trip")).toBe(true);
    const follow = xaiFollowUpBody("resp_1", [{ callId: "call_1", output: "measured" }], false);
    expect(follow.tools.some((tool) => tool.type === "web_search")).toBe(false);
    expect(follow.max_output_tokens).toBe(400);
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
