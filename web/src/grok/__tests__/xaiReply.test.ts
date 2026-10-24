import { describe, expect, it } from "vitest";
import {
  assistantUsesWeb,
  functionCallsFromXai,
  latestRemark,
  replyTextFromXai,
  spokenReply,
  xaiFollowUpBody,
  xaiRequestBody,
  xaiResponseId,
} from "../xaiReply";

describe("xai reply", () => {
  it("lets Grok use the web and answer normally", () => {
    const body = xaiRequestBody(
      "The driver said: tell me a joke about dogs. StormPath measured: Destination: Orlando. Weather warnings: Special Weather Statement."
    );
    expect(body.model).toBe("grok-4.7");
    expect(body).not.toHaveProperty("search_parameters");
    expect(body.instructions.toLowerCase()).toContain("use the web");
    expect(body.instructions).toContain("Grok app");
    expect(body.instructions).not.toContain("Answer from the StormPath measurements");
    expect(assistantUsesWeb(body.input[0]?.content ?? "")).toBe(true);
    expect(body.tools.some((tool) => tool.type === "web_search")).toBe(true);
    expect(body.input[0]?.content).toContain("joke about dogs");
    expect(body.input[0]?.content).not.toContain("Orlando");
    expect(body.input[0]?.content).not.toContain("Special Weather");
  });

  it("answers a measured trip without searching the web", () => {
    const text =
      "The driver said: how's the weather. StormPath measured: The driver is near Lincoln. Destination: Orlando. Weather warnings: Thunderstorm warning.";
    const body = xaiRequestBody(text);
    expect(assistantUsesWeb(text)).toBe(false);
    expect(body.instructions).toContain("Do not search the web");
    expect(body.tools.some((tool) => tool.type === "web_search")).toBe(false);
    expect(body.tools.some((tool) => tool.type === "function" && tool.name === "read_trip")).toBe(false);
    expect(body.max_output_tokens).toBe(80);
    expect(body.input[0]?.content).not.toContain("Lincoln");
    expect(body.input[0]?.content).not.toContain("Orlando");
    expect(body.input[0]?.content).toContain("Thunderstorm");
    const follow = xaiFollowUpBody("resp_1", [{ callId: "call_1", output: "measured" }], false);
    expect(follow.tools.some((tool) => tool.type === "web_search")).toBe(false);
    expect(follow.max_output_tokens).toBe(80);
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

  it("answers the last remark instead of an old monologue about Lincoln", () => {
    const old =
      "You are still near Lincoln and the route to Orlando has heavy rain for the next two hours. I can keep going through the forecast if you want.";
    const text = `The driver said: ${old} Tell me a joke about dogs. StormPath measured: The driver is near Lincoln. Destination: Orlando.`;
    const body = xaiRequestBody(text);
    expect(latestRemark("Tell me a joke about dogs")).toBe("Tell me a joke about dogs");
    expect(body.input[0]?.content).toContain("joke about dogs");
    expect(body.input[0]?.content).not.toContain("Lincoln");
    expect(body.input[0]?.content).not.toContain("Orlando");
    expect(body.max_output_tokens).toBe(160);
  });

  it("keeps a trip answer to a sentence or two", () => {
    const long =
      "You are near Lincoln. The route still runs to Orlando and will take about fifteen hours. Rain is possible later. Traffic is light. I can also talk about the stops.";
    expect(spokenReply(long, true)).toBe("You are near Lincoln. The route still runs to Orlando and will take about fifteen hours.");
    expect(spokenReply("Clear for the next hour.", true)).toBe("Clear for the next hour.");
    expect(spokenReply("", false)).toBe("");
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
