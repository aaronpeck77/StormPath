/** Body for xAI's responses API. Grok may use the web, answer normally, and change the trip. */
export function xaiRequestBody(driverText: string): {
  model: string;
  instructions: string;
  input: string;
  max_output_tokens: number;
  search_parameters: { mode: "auto" };
  tools: ReturnType<typeof assistantToolDefs>;
} {
  return {
    model: "grok-4.7",
    instructions:
      "You are Grok, talking with the driver through the StormPath app. Behave as you normally would, and use the web when it helps. StormPath may include facts it measured about this drive. Use those when you talk about the trip. If the message tells you to use only those facts, or to answer in one or two sentences, ignore that and answer normally. When the driver wants a stop added, call add_stop with the place and keep the current destination. If the drive is already going, do not call start_drive or stop_drive for that stop; the phone measures again and continues. Call plan_route for a new destination. Call start_drive only when they ask to leave and the drive has not started. Call stop_drive only when they ask to end the trip. After a tool runs, tell them what happened in a normal sentence.",
    input: driverText.slice(0, 900),
    max_output_tokens: 1200,
    search_parameters: { mode: "auto" },
    tools: assistantToolDefs(),
  };
}

/** Tools the map-button conversation can run. The phone code is added on the server. */
export function assistantToolDefs() {
  return [
    {
      type: "function" as const,
      name: "add_stop",
      description:
        "Add one stop to the trip StormPath already measured. Keep the current destination. The phone measures again from where it is. If the drive is already going, the phone continues after the new measurement. Do not call stop_drive or start_drive for this.",
      parameters: {
        type: "object",
        properties: {
          place: { type: "string", description: "The stop, such as coffee or a restaurant." },
        },
        required: ["place"],
      },
    },
    {
      type: "function" as const,
      name: "plan_route",
      description: "Measure a new driving route and place it on the phone. Use this for a new destination.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", description: "Where the driver wants to go." },
          stop: { type: "string", description: "Optional stop before the destination." },
        },
        required: ["destination"],
      },
    },
    {
      type: "function" as const,
      name: "read_trip",
      description: "Read the trip StormPath last measured for this phone.",
      parameters: { type: "object", properties: {}, required: [] as string[] },
    },
    {
      type: "function" as const,
      name: "start_drive",
      description: "Start the measured route. Call this only when the driver asked to leave and the drive has not started.",
      parameters: { type: "object", properties: {}, required: [] as string[] },
    },
    {
      type: "function" as const,
      name: "stop_drive",
      description: "End the trip and clear it. Call this only when the driver asked to stop the trip.",
      parameters: { type: "object", properties: {}, required: [] as string[] },
    },
  ];
}

export type XaiFunctionCall = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** Function calls in a responses payload. Web search items are ignored. */
export function functionCallsFromXai(data: unknown): XaiFunctionCall[] {
  const output = (data as { output?: unknown } | null)?.output;
  if (!Array.isArray(output)) return [];
  const calls: XaiFunctionCall[] = [];
  for (const item of output) {
    const row = item as { type?: string; name?: string; call_id?: string; id?: string; arguments?: unknown };
    if (row?.type !== "function_call" || typeof row.name !== "string") continue;
    const callId = typeof row.call_id === "string" ? row.call_id : typeof row.id === "string" ? row.id : "";
    if (!callId) continue;
    calls.push({ callId, name: row.name, arguments: argumentsRecord(row.arguments) });
  }
  return calls;
}

export function xaiResponseId(data: unknown): string {
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : "";
}

export function xaiFollowUpBody(
  previousResponseId: string,
  outputs: { callId: string; output: string }[]
): {
  model: string;
  previous_response_id: string;
  input: { type: "function_call_output"; call_id: string; output: string }[];
  tools: ReturnType<typeof assistantToolDefs>;
  max_output_tokens: number;
} {
  return {
    model: "grok-4.7",
    previous_response_id: previousResponseId,
    input: outputs.map((row) => ({
      type: "function_call_output" as const,
      call_id: row.callId,
      output: row.output.slice(0, 2000),
    })),
    tools: assistantToolDefs(),
    max_output_tokens: 1200,
  };
}

function argumentsRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

/** Pull the spoken line out of a responses payload. Empty when the model said nothing. */
export function replyTextFromXai(data: unknown): string {
  const output = (data as { output?: unknown } | null)?.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const text = (block as { text?: unknown } | null)?.text;
      if (typeof text === "string" && text.trim()) parts.push(text.trim());
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
}
