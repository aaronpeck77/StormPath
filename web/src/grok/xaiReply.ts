import { driverSaid, isTripTalk } from "./assistantTurn";

const FREE_INSTRUCTIONS =
  "You are Grok, the same assistant as in the Grok app, keeping a driver company so they stay awake and focused. Talk as you normally would. Use the web when it helps. This is ordinary conversation. Do not mention StormPath, the route, the trip, the weather, the forecast, or the traffic unless they asked. A few spoken sentences is enough. When they want a stop added, call add_stop with the place and keep the current destination. If the drive is already going, do not call start_drive or stop_drive for that stop. Call plan_route for a new destination. Call start_drive only when they ask to leave and the drive has not started. Call stop_drive only when they ask to end the trip. After a tool runs, tell them what happened in a normal sentence.";

const TRIP_INSTRUCTIONS =
  "You are Grok, talking with the driver through the StormPath app. They asked about the trip or the weather. Answer from the StormPath measurements in one or two sentences. Do not search the web. Do not invent a storm or a time. Do not call a tool unless they asked to change the destination, add a stop, start the drive, or end the trip. When they want a stop, call add_stop and keep the current destination. If the drive is already going, do not call start_drive or stop_drive for that stop. Call plan_route for a new destination. Call start_drive only when they ask to leave and the drive has not started. Call stop_drive only when they ask to end the trip. After a tool runs, tell them what happened in a normal sentence.";

/** Weather and route questions stay on the measurements. Ordinary talk can use the web. */
export function assistantUsesWeb(driverText: string): boolean {
  return !isTripTalk(driverSaid(driverText));
}

/** Drop the forecast unless they asked about the trip or the weather. */
export function spokenPrompt(raw: string): string {
  const said = driverSaid(raw);
  if (isTripTalk(said)) return raw.replace(/\s+/g, " ").trim().slice(0, 900);
  return `The driver said: ${said}. This is free talk. Answer as you normally would. Do not mention the route, the weather, the forecast, the traffic, or the drive unless they asked.`.slice(
    0,
    900
  );
}

/** Body for xAI's responses API. Grok may use the web, answer normally, and change the trip. */
export function xaiRequestBody(driverText: string): {
  model: string;
  instructions: string;
  input: { role: "user"; content: string }[];
  max_output_tokens: number;
  tools: ReturnType<typeof assistantToolDefs>;
} {
  const includeWeb = assistantUsesWeb(driverText);
  return {
    model: "grok-4.7",
    instructions: includeWeb ? FREE_INSTRUCTIONS : TRIP_INSTRUCTIONS,
    input: [{ role: "user", content: spokenPrompt(driverText) }],
    max_output_tokens: 1200,
    tools: assistantToolDefs(includeWeb),
  };
}

/** Tools the map-button conversation can run. The phone code is added on the server. */
export function assistantToolDefs(includeWeb = true) {
  const web = includeWeb ? [{ type: "web_search" as const }] : [];
  return [
    ...web,
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
  outputs: { callId: string; output: string }[],
  includeWeb = true
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
    tools: assistantToolDefs(includeWeb),
    max_output_tokens: 400,
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
  const top = (data as { output_text?: unknown } | null)?.output_text;
  if (typeof top === "string" && top.trim()) return top.replace(/\s+/g, " ").trim().slice(0, 4000);
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
