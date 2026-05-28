import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { useSettingsStore } from "../state/settingsStore";

/**
 * Haptic feedback wrapper — Phase 8.
 *
 * Single touch-point between StormPath UI and `@capacitor/haptics`. Every export is safe
 * to call on web (where it no-ops) and is fire-and-forget — promise rejections from the
 * native bridge are swallowed silently because (a) they're never actionable mid-tap and
 * (b) crashing a Go-button click because Taptic Engine is unhappy would be terrible UX.
 *
 * **Settings-aware:** every call checks `useSettingsStore.getState().hapticsEnabled` and
 * bails out if the user has disabled haptics in About → Feedback. We read the store
 * imperatively (not via a hook) because most call sites are inside event handlers and
 * imperative effects, not render functions.
 *
 * **Why named functions instead of "level" parameters:** the call sites stay self-documenting
 * (`hapticOnGoTap()` reads as the action, not a generic vibration). When we later tune the
 * vibration profile per moment we can change one definition rather than chase down arguments.
 */

function isHapticsEnabled(): boolean {
  /* Native-only — Web Vibration API exists but its taps feel completely different from
   * iOS Taptic Engine, and triggering it on desktop browsers is more annoying than helpful.
   * If we ever want a web fallback, do it deliberately, not by accident. */
  if (!Capacitor.isNativePlatform()) return false;
  try {
    return useSettingsStore.getState().hapticsEnabled;
  } catch {
    /* If the store hasn't hydrated yet (very early app boot), default to enabled — the
     * first moments before the user has a chance to flip the setting are exactly when a
     * haptic confirms the tap registered. */
    return true;
  }
}

function fireImpact(style: ImpactStyle): void {
  if (!isHapticsEnabled()) return;
  void Haptics.impact({ style }).catch(() => undefined);
}

function fireNotification(type: NotificationType): void {
  if (!isHapticsEnabled()) return;
  void Haptics.notification({ type }).catch(() => undefined);
}

/**
 * Light tap — used for low-stakes acknowledgments (chip tap, save place success, snippet copy).
 * Equivalent to `UIImpactFeedbackStyle.light`.
 */
export function hapticTapLight(): void {
  fireImpact(ImpactStyle.Light);
}

/**
 * Medium tap — used for primary actions that change app state (Go button, route promotion).
 * Equivalent to `UIImpactFeedbackStyle.medium`.
 */
export function hapticTapMedium(): void {
  fireImpact(ImpactStyle.Medium);
}

/**
 * Heavy tap — reserved for destructive confirmations (currently unused; kept for completeness).
 * Equivalent to `UIImpactFeedbackStyle.heavy`.
 */
export function hapticTapHeavy(): void {
  fireImpact(ImpactStyle.Heavy);
}

/**
 * Success notification — three short ascending taps. Used after purchase / restore /
 * "Plus is now active" transitions where the user has just done something correctly.
 * Equivalent to `UINotificationFeedbackType.success`.
 */
export function hapticSuccess(): void {
  fireNotification(NotificationType.Success);
}

/**
 * Warning notification — two-tap pattern. Used when nav has detected the user has gone
 * off-route and is automatically rerouting; tells them to glance up at the screen without
 * being alarming.
 * Equivalent to `UINotificationFeedbackType.warning`.
 */
export function hapticWarning(): void {
  fireNotification(NotificationType.Warning);
}

/**
 * Error notification — buzz pattern. Used for purchase / restore failures and other
 * "this didn't work, you might want to try again" moments.
 * Equivalent to `UINotificationFeedbackType.error`.
 */
export function hapticError(): void {
  fireNotification(NotificationType.Error);
}
