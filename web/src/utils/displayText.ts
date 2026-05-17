/** Collapse whitespace only — never shorten user-facing copy with an ellipsis. */
export function displayText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
