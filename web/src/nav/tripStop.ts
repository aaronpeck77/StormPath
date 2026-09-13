/**
 * End native Core (if any) before wiping the web trip.
 * Stopping both at once is what crashed the IPA on Stop.
 */
export async function stopGuidanceThenClearTrip(
  stopNativeGuidance: (() => Promise<void>) | undefined,
  clearTrip: () => void
): Promise<void> {
  if (stopNativeGuidance) {
    try {
      await stopNativeGuidance();
    } catch {
      /* web / plugin missing */
    }
  }
  clearTrip();
}
