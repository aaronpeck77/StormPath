# App Store submission checklist (after beta)

Use this when moving from **TestFlight beta** to **public App Store**. Does not replace beta workflow in [`GITHUB_TESTFLIGHT_ONLY.md`](GITHUB_TESTFLIGHT_ONLY.md).

## Build flavor

| Track | Command / trigger | Plus tier |
|-------|-------------------|-----------|
| TestFlight beta | `build:testflight` / push `master` | Forced Plus (`.env.testflight`) |
| App Store customer | `npm run build` (not testflight mode) | **Basic** unless IAP works |

Do **not** ship `VITE_PAY_TIER=plus` on the public customer binary.

## Before submit for review

- [ ] **In-App Purchase** wired → `setNativePlusEntitlementActive` after purchase ([`storeEntitlement.ts`](../web/src/billing/storeEntitlement.ts))
- [ ] `VITE_UPGRADE_URL` → live App Store product page
- [ ] `VITE_PAY_TIER_TEST_PANEL` **not** `true` in production env
- [ ] **Sentry** `VITE_SENTRY_DSN` in release builds
- [ ] Screenshots + description for required iPhone sizes
- [ ] **App Privacy** questionnaire in App Store Connect matches location + diagnostics
- [ ] **Export compliance** — `ITSAppUsesNonExemptEncryption` is `false` in `Info.plist` (standard HTTPS only)
- [ ] Support URL + privacy policy URLs live (bundled or hosted)
- [ ] Test **Basic** build on device (`npm run build` + archive or separate CI job)

## Already in the project

- Location usage strings in `web/ios/App/App/Info.plist`
- Privacy policy / terms / support HTML in `web/public/`
- Bundle ID `com.aaronpeck.stormpath` (see `capacitor.config.ts`)

## Signing

Same GitHub secrets as TestFlight (`APPLE_*`, App Store Connect API key). Only the **web build mode** and **tier env** change for retail.
