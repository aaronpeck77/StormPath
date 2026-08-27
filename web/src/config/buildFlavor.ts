/**
 * IPA / web bundle flavor. Runtime helpers follow Vite `MODE` / `VITE_PAY_TIER`.
 * Grep-able stamps are compile-time `define`s from `vite.config.ts` so only the
 * active track’s strings land in dist (see `scripts/assert-ios-build-flavor.mjs`).
 */

declare const __STORMPATH_FLAVOR_STAMP__: string;
declare const __STORMPATH_PLUS_FORCED_STAMP__: string;
declare const __STORMPATH_TEST_PANEL_STAMP__: string;
declare const __STORMPATH_ADMOB_TEST_STAMP__: string;

export type StormpathBuildFlavor = "dev" | "testflight" | "appstore";

export function stormpathBuildFlavor(): StormpathBuildFlavor {
  if (import.meta.env.DEV) return "dev";
  if (import.meta.env.MODE === "testflight") return "testflight";
  return "appstore";
}

export function isForcedPlusBinary(): boolean {
  const v = (import.meta.env.VITE_PAY_TIER as string | undefined)?.toLowerCase();
  return v === "plus" || v === "pro";
}

export function stormpathFlavorStamp(): string {
  return __STORMPATH_FLAVOR_STAMP__;
}

export function stormpathPlusForcedStamp(): string {
  return __STORMPATH_PLUS_FORCED_STAMP__;
}

export function stormpathTestPanelStamp(): string {
  return __STORMPATH_TEST_PANEL_STAMP__;
}

export function stormpathAdmobTestStamp(): string {
  return __STORMPATH_ADMOB_TEST_STAMP__;
}

/** Keep stamps reachable from the entry chunk so CI can grep the IPA web bundle. */
export function stormpathFlavorGuardString(): string {
  return [
    stormpathFlavorStamp(),
    stormpathPlusForcedStamp(),
    stormpathTestPanelStamp(),
    stormpathAdmobTestStamp(),
  ].join("|");
}

export function stormpathFlavorChipLabel(): string | null {
  const flavor = stormpathBuildFlavor();
  if (flavor === "testflight") return "TestFlight";
  if (flavor === "appstore") return "App Store";
  return null;
}
