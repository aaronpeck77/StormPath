import { driverSaid, isTripTalk } from "./assistantTurn";

const FREE_INSTRUCTIONS =
  "You are Grok, sitting with the driver and talking the way you do in the Grok app. This turn is only what they just said. You do not know their city or their route. Earlier trips are over. Do not mention a place, a route, the weather, or StormPath unless they just asked. Speak one or two short sentences, then stop so they can answer. Use the web when it helps. Call a tool only if they asked to change the destination, add a stop, start driving, or end the trip.";

const TRIP_INSTRUCTIONS =
  "You are Grok. They asked one thing about the trip or the weather. Speak one short sentence. A second sentence only if they asked two things. Do not recap the destination, name a city, or retell the drive. Do not mention an earlier trip. Do not search the web. Do not invent a storm or a time. Call a tool only if they asked to change the destination, add a stop, start driving, or end the trip.";

const TRIP_TOKENS = 80;
const FREE_TOKENS = 160;

/** The last thing they said. A long transcript is usually the previous reply picked up by the mic. */
export function latestRemark(said: string): string {
  const text = said.replace(/\s+/g, " ").trim();
  if (text.length <= 140) return text;
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  let last = (parts[parts.length - 1] ?? text).trim();
  if (last.length > 140) last = last.slice(-140).replace(/^\S*\s/, "").trim();
  return last || text.slice(-140);
}

/** Weather and route questions stay on the measurements. Ordinary talk can use the web. */
export function assistantUsesWeb(driverText: string): boolean {
  return !isTripTalk(latestRemark(driverSaid(driverText)));
}

function askedWhere(said: string): boolean {
  return /\bwhere am i|where are we(?! going)|what (?:town|city)\b/i.test(said);
}

function askedRoute(said: string): boolean {
  return /\b(destination|where are we going|where we going|the route|our route|which route|eta|how long|how much longer|how far|miles left|time left|when do we)\b/i.test(
    said
  );
}

/** Keep the measurement that answers this question. Drop the city and the old route recap. */
export function tripFactsForQuestion(raw: string, said: string): string {
  const measured = raw.match(/stormpath measured:\s*(.*)$/i)?.[1] ?? "";
  let facts = measured.replace(/\s+/g, " ").trim();
  if (!askedWhere(said)) facts = facts.replace(/The driver is near [^.]+\.?\s*/gi, "");
  if (!askedRoute(said)) {
    facts = facts.replace(/Destination:[^.]+\.?\s*/gi, "");
    facts = facts.replace(/Time left:[^.]+\.?\s*/gi, "");
    facts = facts.replace(/Distance left:[^.]+\.?\s*/gi, "");
    facts = facts.replace(/The drive (?:is already going|has not started)\.?\s*/gi, "");
  }
  facts = facts.replace(/\s+/g, " ").trim();
  return facts
    ? `StormPath measured just now: ${facts} Answer only what they just asked, in one short sentence.`
    : "Answer in one short sentence. Do not name a city or recap a route.";
}

/** Drop the forecast unless they asked about the trip or the weather. */
export function spokenPrompt(raw: string): string {
  const said = latestRemark(driverSaid(raw));
  if (isTripTalk(said)) {
    return `The driver said: ${said}. ${tripFactsForQuestion(raw, said)}`.replace(/\s+/g, " ").trim().slice(0, 700);
  }
  return `The driver said: ${said}. This is a new turn. You do not know where they are. Do not bring up an earlier drive.`.slice(
    0,
    500
  );
}

/** One or two spoken sentences. Trip answers stay shorter than ordinary talk. */
export function spokenReply(text: string, tripTalk: boolean): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  const maxSentences = tripTalk ? 2 : 3;
  const maxWords = tripTalk ? 32 : 55;
  const clipped = (sentences && sentences.length > 0 ? sentences.slice(0, maxSentences).join(" ") : clean)
    .replace(/\s+/g, " ")
    .trim();
  const words = clipped.split(/\s+/);
  if (words.length <= maxWords) return clipped;
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;]+$/, "")}.`;
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
    max_output_tokens: includeWeb ? FREE_TOKENS : TRIP_TOKENS,
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
    max_output_tokens: includeWeb ? FREE_TOKENS : TRIP_TOKENS,
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
