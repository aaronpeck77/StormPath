/**
 * Stormy stays in the app, but this build starts like the app did before her.
 * Info still shows her control, greyed out, until this is turned on.
 */
export const STORMY_AVAILABLE = false;

/** Map button only when she is finished and the driver has turned her on. */
export function stormyMapButtonOn(savedEnabled: boolean): boolean {
  return STORMY_AVAILABLE && savedEnabled;
}
