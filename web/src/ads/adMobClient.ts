import { Capacitor } from "@capacitor/core";
import {
  AdMob,
  BannerAdOptions,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
} from "@capacitor-community/admob";

/** Google sample banner — safe for dev until you paste real unit ids from AdMob. */
export const ADMOB_TEST_BANNER_UNIT_ID = "ca-app-pub-3940256099942544/2934735716";

/**
 * App Tracking Transparency (ATT) status as resolved by `ensureTrackingAuthorization()`.
 *
 *   - `authorized`    — user tapped "Allow" in the iOS ATT modal. We may serve personalized ads.
 *   - `denied`        — user tapped "Ask App Not to Track." Banner stays non-personalized (`npa: true`).
 *   - `notDetermined` — modal hasn't been shown or completed yet (transient state).
 *   - `restricted`    — parental controls / MDM blocks tracking. Treat as denied.
 *   - `unsupported`   — running on web / Android / pre-iOS-14 where ATT does not apply.
 */
export type TrackingAuthorizationOutcome =
  | "authorized"
  | "denied"
  | "notDetermined"
  | "restricted"
  | "unsupported";

let initialized = false;
let bannerVisible = false;
let failureListenerAttached = false;
let trackingAuthorization: TrackingAuthorizationOutcome | null = null;
let trackingAuthorizationInFlight: Promise<TrackingAuthorizationOutcome> | null = null;

function attachFailureListenerOnce(): void {
  if (failureListenerAttached) return;
  failureListenerAttached = true;
  AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => {
    /* Silent — house promos still show in the advisory strip. */
  });
}

export function isAdMobSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Request iOS App Tracking Transparency authorization on the first call; cache + return the
 * resolved status on every call after that. Apple requires this before `AdMob.initialize(...)`
 * runs because AdMob keys IDFA reads off the resolved ATT status.
 *
 * Plus users never reach this code (they never see banners); Basic users hit the modal
 * exactly once on the first foreground that triggers a banner show. Concurrent callers share
 * a single in-flight promise so we never present the modal twice.
 *
 * On non-native (web preview), Android, or pre-iOS-14 devices the plugin call returns a
 * non-iOS status; we collapse that to `"unsupported"` and downstream callers fall back to
 * non-personalized ads.
 */
export async function ensureTrackingAuthorization(): Promise<TrackingAuthorizationOutcome> {
  if (!isAdMobSupported()) return "unsupported";
  if (trackingAuthorization) return trackingAuthorization;
  if (trackingAuthorizationInFlight) return trackingAuthorizationInFlight;

  trackingAuthorizationInFlight = (async () => {
    try {
      const initial = await AdMob.trackingAuthorizationStatus();
      if (initial.status === "notDetermined") {
        /* Triggers the iOS "Allow / Ask App Not to Track" modal. Resolves once the user picks. */
        await AdMob.requestTrackingAuthorization();
        const resolved = await AdMob.trackingAuthorizationStatus();
        trackingAuthorization = resolved.status;
      } else {
        trackingAuthorization = initial.status;
      }
    } catch {
      /* Plugin call shouldn't fail in production, but if it does we treat the user as having
       * declined — non-personalized ads, no tracking. Safe-by-default. */
      trackingAuthorization = "denied";
    } finally {
      trackingAuthorizationInFlight = null;
    }
    return trackingAuthorization!;
  })();

  return trackingAuthorizationInFlight;
}

export async function initAdMob(opts: {
  testMode: boolean;
}): Promise<void> {
  if (!isAdMobSupported() || initialized) return;
  /* ATT must complete before AdMob.initialize so the SDK reads the IDFA (or doesn't) under
   * the resolved authorization. Without this ordering Apple's reviewers reject — they verify
   * by inspecting the network traffic right after first launch. */
  await ensureTrackingAuthorization();
  await AdMob.initialize({
    initializeForTesting: opts.testMode,
    testingDevices: [],
  });
  initialized = true;
}

export async function showBasicBanner(opts: {
  adUnitId: string;
  testMode: boolean;
  /** Pixels above the bottom safe area / dock (keeps banner above My location row). */
  bottomMarginPx: number;
}): Promise<void> {
  if (!isAdMobSupported()) return;
  const adId = opts.adUnitId.trim() || ADMOB_TEST_BANNER_UNIT_ID;

  if (!initialized) {
    await initAdMob({ testMode: opts.testMode });
  }

  if (bannerVisible) {
    await AdMob.hideBanner().catch(() => undefined);
    bannerVisible = false;
  }

  /* `npa = "non-personalized ads"`. When the user explicitly authorizes tracking we serve
   * personalized ads; in every other case (denied / restricted / notDetermined / unsupported)
   * we keep `npa: true` so we never read IDFA without consent. */
  const trackingStatus = await ensureTrackingAuthorization();
  const npa = trackingStatus !== "authorized";

  const options: BannerAdOptions = {
    adId,
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: opts.bottomMarginPx,
    isTesting: opts.testMode,
    npa,
  };

  attachFailureListenerOnce();

  await AdMob.showBanner(options);
  bannerVisible = true;
}

export async function hideBasicBanner(): Promise<void> {
  if (!isAdMobSupported() || !bannerVisible) return;
  await AdMob.hideBanner().catch(() => undefined);
  bannerVisible = false;
}

export async function removeBasicBanner(): Promise<void> {
  if (!isAdMobSupported()) return;
  await AdMob.removeBanner().catch(() => undefined);
  bannerVisible = false;
}
