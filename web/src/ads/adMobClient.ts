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
let trackingAuthorization: TrackingAuthorizationOutcome | null = null;
let trackingAuthorizationInFlight: Promise<TrackingAuthorizationOutcome> | null = null;

export type BasicBannerLoadOutcome = "loaded" | "failed";

let bannerLoadOutcome: BasicBannerLoadOutcome | null = null;
let bannerLoadFailureMessage = "";
const bannerLoadListeners = new Set<(outcome: BasicBannerLoadOutcome) => void>();
/** Native banner height in CSS pixels. 0 means the banner is gone. */
let bannerHeightPx = 0;
const bannerHeightListeners = new Set<(heightPx: number) => void>();
let bannerListenersReady: Promise<void> | null = null;

/** Latest UI slot from `useBasicAdMobBanner` — About diagnostics only. */
let bannerUiSlot: "hidden" | "loading" | "filled" | "empty" = "hidden";
let bannerOpSerial = 0;
let bannerOpChain: Promise<void> = Promise.resolve();

function enqueueBannerOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = bannerOpChain.then(fn, fn);
  bannerOpChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function setBannerLoadOutcome(outcome: BasicBannerLoadOutcome, failureMessage = ""): void {
  bannerLoadOutcome = outcome;
  bannerLoadFailureMessage =
    outcome === "failed" ? failureMessage.trim() || "no fill" : "";
  for (const listener of bannerLoadListeners) {
    listener(outcome);
  }
}

export function recordBasicBannerUiSlot(
  slot: "hidden" | "loading" | "filled" | "empty"
): void {
  bannerUiSlot = slot;
}

/** One-line AdMob status for About → Support diagnostics. */
export function getBasicBannerDebugLine(): string {
  const mode = resolveAdMobTestModeForDebug() ? "test creatives" : "live";
  if (!isAdMobSupported()) return `ads: web (no AdMob, ${mode})`;
  if (bannerUiSlot === "filled") return `ads: showing (${mode})`;
  if (bannerUiSlot === "loading") return `ads: loading (${mode})`;
  if (bannerUiSlot === "empty") {
    const why = bannerLoadFailureMessage || "no fill";
    return `ads: empty (${mode}, ${why})`;
  }
  return `ads: hidden (${mode})`;
}

/** Short About note when Basic asked Google for a banner and got nothing. */
export function getBasicBannerCustomerHint(): string | null {
  if (!isAdMobSupported()) return null;
  if (bannerUiSlot !== "empty") return null;
  return "Bottom Google ads are on for Basic. None loaded this session — common on TestFlight before the app is listed on the App Store.";
}

function resolveAdMobTestModeForDebug(): boolean {
  return (
    import.meta.env.DEV ||
    String(import.meta.env.VITE_ADMOB_TEST_MODE ?? "").toLowerCase() === "true"
  );
}

export function subscribeBasicBannerLoad(
  listener: (outcome: BasicBannerLoadOutcome) => void
): () => void {
  bannerLoadListeners.add(listener);
  if (bannerLoadOutcome) listener(bannerLoadOutcome);
  return () => bannerLoadListeners.delete(listener);
}

/** Height AdMob last reported. 0 when the banner is hidden, removed, or failed. */
export function subscribeBasicBannerHeight(listener: (heightPx: number) => void): () => void {
  bannerHeightListeners.add(listener);
  listener(bannerHeightPx);
  return () => bannerHeightListeners.delete(listener);
}

/** Pull a banner height out of the plugin's SizeChanged payload. */
export function readBannerHeightPx(info: unknown): number {
  if (typeof info === "number" && Number.isFinite(info)) return info > 0 ? Math.round(info) : 0;
  if (!info || typeof info !== "object") return 0;
  const rec = info as { height?: unknown; size?: { height?: unknown } };
  const raw =
    rec.height ?? (rec.size && typeof rec.size === "object" ? rec.size.height : undefined);
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

export function getBasicBannerHeightPx(): number {
  return bannerHeightPx;
}

function publishBannerHeight(heightPx: number): void {
  const next = heightPx > 0 ? Math.round(heightPx) : 0;
  if (next === bannerHeightPx) return;
  bannerHeightPx = next;
  for (const listener of bannerHeightListeners) listener(next);
}

/**
 * Register before the first show. The plugin draws the banner above the WebView
 * and will not replay SizeChanged if we subscribe late.
 */
function ensureBannerListeners(): Promise<void> {
  if (!bannerListenersReady) {
    bannerListenersReady = Promise.all([
      AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (info) => {
        const message =
          info && typeof info === "object" && "message" in info
            ? String((info as { message?: unknown }).message ?? "")
            : "";
        setBannerLoadOutcome("failed", message);
        publishBannerHeight(0);
      }),
      AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
        setBannerLoadOutcome("loaded");
      }),
      AdMob.addListener(BannerAdPluginEvents.SizeChanged, (info) => {
        publishBannerHeight(readBannerHeightPx(info));
      }),
    ]).then(() => undefined);
  }
  return bannerListenersReady;
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
}): Promise<boolean> {
  if (!isAdMobSupported()) return false;
  const adId = opts.adUnitId.trim() || ADMOB_TEST_BANNER_UNIT_ID;
  const mySerial = ++bannerOpSerial;

  return enqueueBannerOp(async () => {
    if (mySerial !== bannerOpSerial) return false;

    if (!initialized) {
      await initAdMob({ testMode: opts.testMode });
    }
    if (mySerial !== bannerOpSerial) return false;

    if (bannerVisible) {
      await AdMob.hideBanner().catch(() => undefined);
      bannerVisible = false;
    }

    bannerLoadOutcome = null;
    bannerLoadFailureMessage = "";

    /* `npa = "non-personalized ads"`. When the user explicitly authorizes tracking we serve
     * personalized ads; in every other case (denied / restricted / notDetermined / unsupported)
     * we keep `npa: true` so we never read IDFA without consent. */
    const trackingStatus = await ensureTrackingAuthorization();
    if (mySerial !== bannerOpSerial) return false;
    const npa = trackingStatus !== "authorized";

    const options: BannerAdOptions = {
      adId,
      adSize: BannerAdSize.BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: opts.bottomMarginPx,
      isTesting: opts.testMode,
      npa,
    };

    await ensureBannerListeners();

    try {
      await AdMob.showBanner(options);
      if (mySerial !== bannerOpSerial) {
        await AdMob.removeBanner().catch(() => undefined);
        bannerVisible = false;
        publishBannerHeight(0);
        return false;
      }
      bannerVisible = true;
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "showBanner failed";
      setBannerLoadOutcome("failed", message);
      bannerVisible = false;
      publishBannerHeight(0);
      return false;
    }
  });
}

export async function hideBasicBanner(): Promise<void> {
  if (!isAdMobSupported() || !bannerVisible) return;
  await AdMob.hideBanner().catch(() => undefined);
  bannerVisible = false;
  publishBannerHeight(0);
}

/** Remove native banner entirely — use when leaving Basic tier or hiding ads for Plus. */
export async function teardownBasicBanner(): Promise<void> {
  if (!isAdMobSupported()) return;
  bannerOpSerial += 1;
  await enqueueBannerOp(async () => {
    await AdMob.removeBanner().catch(() => undefined);
    bannerVisible = false;
    bannerLoadOutcome = null;
    bannerLoadFailureMessage = "";
    publishBannerHeight(0);
  });
}

export async function removeBasicBanner(): Promise<void> {
  await teardownBasicBanner();
}
