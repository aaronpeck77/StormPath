/** The sentences Stormy will obey. Shown on the Info page. One place per tap. */

export const STORMY_ONE_PLACE =
  "I can take one place at a time. Set the destination, then tap me again for the stop.";

export const STORMY_COMMANDS = [
  "Take me to …",
  "Go.",
  "Stop the route.",
  "Refresh.",
  "Be quiet.",
] as const;

export function asksWhatStormyCanDo(lower: string): boolean {
  return (
    /\bwhat can (?:you|stormy|i) (?:do|say)\b/.test(lower) ||
    /\b(?:your|stormy's|the) commands\b/.test(lower) ||
    /\bhow do i (?:use|talk to) (?:you|stormy)\b/.test(lower)
  );
}
