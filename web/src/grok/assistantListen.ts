/** A missed phrase is not a missing microphone. Only a real permission block is "No mic". */

export function isMicDenied(message: string): boolean {
  return /denied|restricted/i.test(message);
}

/** The mic worked, then the audio session switch failed. Worth one retry. */
export function isTransientMicFailure(message: string): boolean {
  return /unavailable/i.test(message) && !isMicDenied(message);
}

export function assistantListenNote(message: string): string {
  if (isMicDenied(message)) return "No mic";
  if (/could not hear|didn.?t catch|did not catch|unavailable|microphone|hear/i.test(message)) {
    return "Didn't catch that.";
  }
  return "No answer";
}
