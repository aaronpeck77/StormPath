/**
 * End native Core (if any) before wiping the web trip.
 * Stopping both at once is what crashed the IPA on Stop.
 */
import { captureAppException } from "../monitoring/sentry";

export async function stopGuidanceThenClearTrip(
  stopNativeGuidance: (() => Promise<void>) | undefined,
  clearTrip: () => void,
  /** Drop turn banner / Drive chrome before async Core teardown (avoids mid-render throws). */
  endNavChrome?: () => void
): Promise<void> {
  if (endNavChrome) {
    try {
      endNavChrome();
    } catch (err) {
      captureAppException(err, { source: "end_nav_chrome_on_stop" });
    }
  }
  if (stopNativeGuidance) {
    try {
      await stopNativeGuidance();
    } catch (err) {
      captureAppException(err, { source: "stop_native_guidance" });
    }
  }
  try {
    clearTrip();
  } catch (err) {
    captureAppException(err, { source: "clear_trip_after_stop" });
  }
}
