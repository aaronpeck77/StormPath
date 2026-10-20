/** Body for xAI's responses API. Search stays off so the reply uses StormPath's facts. */
export function xaiRequestBody(driverText: string): {
  model: string;
  instructions: string;
  input: string;
  max_output_tokens: number;
  search_parameters: { mode: "off" };
} {
  return {
    model: "grok-4.7",
    instructions:
      "You are the driver's assistant inside StormPath. Answer in one or two short sentences they can hear while driving. For the road and the weather, use only the measured facts in the message. Do not invent a hazard, a speed, or a place.",
    input: driverText.slice(0, 900),
    max_output_tokens: 180,
    search_parameters: { mode: "off" },
  };
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
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
}
