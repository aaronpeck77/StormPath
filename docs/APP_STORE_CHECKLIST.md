# App Store submission checklist (after beta)

Use this when moving from **TestFlight beta** to **public App Store**. Does not replace beta workflow in [`GITHUB_TESTFLIGHT_ONLY.md`](GITHUB_TESTFLIGHT_ONLY.md).

## Build flavor

| Track | Command / trigger | Plus tier | How you tell |
|-------|-------------------|-----------|--------------|
| TestFlight beta | `build:testflight` / push `master` | Forced Plus (`.env.testflight`) | About chip **TestFlight** |
| App Store customer | Actions → Run workflow → `build_track` = **`appstore`** (`npm run build:appstore`) | **Basic** until IAP | About chip **App Store** + **Basic** |

CI greps the web bundle for `STORMPATH_FLAVOR_STAMP_*` / `STORMPATH_PLUS_FORCED_*` and **fails** if an appstore build is forced Plus, has the test-tier panel, or AdMob test mode. Do **not** submit a TestFlight Plus IPA.

On device: `i` → header chips must read **App Store** and **Basic** (until Subscribe) before you click Submit for Review.

## Before submit for review

- [ ] **In-App Purchase** wired → `setNativePlusEntitlementActive` after purchase ([`storeEntitlement.ts`](../web/src/billing/storeEntitlement.ts))
- [ ] `VITE_UPGRADE_URL` → live App Store product page
- [ ] `VITE_PAY_TIER_TEST_PANEL` **not** `true` in production env
- [ ] **Sentry** `VITE_SENTRY_DSN` in release builds
- [ ] Screenshots + description for required iPhone sizes
- [ ] **App Privacy** questionnaire in App Store Connect matches location, diagnostics, **Device ID / advertising** (ATT + AdMob), and the live privacy page
- [ ] Deploy updated `web/public/privacy.html` to https://stormpath2.netlify.app/privacy.html (ATT, RevenueCat, Sentry)
- [ ] **Export compliance** — `ITSAppUsesNonExemptEncryption` is `false` in `Info.plist` (standard HTTPS only)
- [ ] Support URL + privacy policy URLs live — **https://stormpath2.netlify.app** ([`NETLIFY_HOSTING.md`](NETLIFY_HOSTING.md))
- [ ] Test **Basic** build on device (`npm run build` + archive or separate CI job)

## Already in the project

- Location usage strings in `web/ios/App/App/Info.plist`
- Privacy policy / terms / support HTML in `web/public/`
- Bundle ID `com.aaronpeck.stormpath` (see `capacitor.config.ts`)

## Signing

Same GitHub secrets as TestFlight (`APPLE_*`, App Store Connect API key). Only the **web build mode** and **tier env** change for retail.
