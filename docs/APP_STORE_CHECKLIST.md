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

## App Review — Guideline 2.3.2 (IAP promotional image)

Apple rejected **4.20.6 (332)** because the **In-App Purchase promotional image was the app icon**. No new IPA is required.

Images live in `web/assets/store/`:

| File | Use on |
|------|--------|
| `stormpath-plus-promo-monthly.png` | Plus **monthly** subscription (and its win-back offer, if any) |
| `stormpath-plus-promo-yearly.png` | Plus **yearly** subscription (and its win-back offer, if any) |

They are 1024×1024 RGB PNGs, flattened, no rounded corners. Same StormPath cloud style as the app icon, but **not** the icon: monthly is a **fall** scene (amber sky, leaves, no lightning), yearly is a **winter** scene (icy sky, snow, no lightning).

### Where to upload (App Store Connect)

Do this on a computer if you can — the phone UI is cramped.

1. Open **[App Store Connect](https://appstoreconnect.apple.com)** → **My Apps** → **StormPath**.
2. Left sidebar: **Monetization** → **Subscriptions**.
3. Open the **StormPath Plus** subscription group.
4. Open **monthly** Plus.
5. Scroll to **Image** (sometimes labeled promotional / App Store image).
6. Remove the old picture if it is the app icon. **Choose File** → upload `stormpath-plus-promo-monthly.png`.
7. **Save**.
8. Back to the group → open **yearly** Plus → same steps with `stormpath-plus-promo-yearly.png` → **Save**.
9. If you see a **win-back offer**, open it and give it the matching monthly or yearly image (not the app icon).
10. Go to the **iOS App** version **4.20.6** → **Resolution Center** / **App Review**. Reply that you replaced the IAP promotional images with unique Plus map artwork (not the app icon), monthly and yearly are different, then **Submit for Review** / **Reply to App Review**.

Do **not** rebuild or re-upload the IPA for this. Do **not** submit a TestFlight Plus build to the store.

## App Review — Guideline 3.1.2(c) + 2.1(b) (subscriptions)

In-app purchase **cannot** be finished from GitHub. After the new **appstore** IPA is in App Store Connect:

1. **Monetization → Subscriptions** — each Plus product (monthly and yearly) must be **Ready to Submit** / attached to this app version. On the version page, check those IAPs so they go in with the binary.
2. **IAP review screenshot** — About (`i`) → **Subscription**. Must show title **StormPath Plus**, length, price, **Privacy Policy**, and **Terms of Use (EULA)**. Use a **Basic App Store** build, not TestFlight Plus.
3. **App Privacy** field: `https://stormpath2.netlify.app/privacy.html`
4. **Terms of Use / EULA**: `https://stormpath2.netlify.app/terms.html`  
   Either paste that URL in App Store Connect’s **EULA** field (custom EULA) **or** put the same link in the **App Description**.
5. **Review notes** — tell reviewers: open **i → Subscription**. Spoken turns only play in the foreground; **audio** was removed from `UIBackgroundModes` (2.5.4). **location** remains for navigation.

Confirm the two URLs load in Safari before you reply to Review.

## Already in the project

- Location usage strings in `web/ios/App/App/Info.plist`
- Privacy policy / terms / support HTML in `web/public/`
- Bundle ID `com.aaronpeck.stormpath` (see `capacitor.config.ts`)

## Signing

Same GitHub secrets as TestFlight (`APPLE_*`, App Store Connect API key). Only the **web build mode** and **tier env** change for retail.
