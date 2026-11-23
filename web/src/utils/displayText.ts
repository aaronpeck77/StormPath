/** Collapse whitespace only — never shorten user-facing copy with an ellipsis. */
export function displayText(text: string | null | undefined): string {
  /* Null-safe: CarPlay companion paints the glance panel on every GO, and a
   * missing timeline label used to throw → ErrorBoundary wiped the trip. */
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
