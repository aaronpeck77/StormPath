/**
 * Command-list Stormy is on for this build. Apple Intelligence stays off.
 */
export const STORMY_AVAILABLE = true;

/** Map button only when she is finished and the driver has turned her on. */
export function stormyMapButtonOn(savedEnabled: boolean): boolean {
  return STORMY_AVAILABLE && savedEnabled;
}
