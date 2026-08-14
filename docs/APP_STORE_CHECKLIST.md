# App Store customer launch — go / no-go

Use this **before** you run the GitHub Actions **appstore** track (the Basic customer IPA).  
TestFlight Plus builds (`push` to `master`) are **not** the binary customers get.

Last audited: **2026-08-14**. Living plans in [`STORE_READINESS_PLAN.md`](STORE_READINESS_PLAN.md) still mix done work with leftover checkboxes — **this file wins** when they disagree.

---

## What CI can prove (already green)

These ran on this audit. They do **not** prove the customer IPA, IAP, ads, or store listing.

| Check | Result |
|-------|--------|
| `cd web && npm test` | **623** tests passed (117 files) |
| `npx tsc --noEmit` | Clean |
| `npm run validate:app-icon` | 1024×1024 opaque RGB, 266 KB |
| Latest TestFlight IPA | [run 31743296922](https://github.com/aaronpeck77/StormPath/actions/runs/31743296922) **success** (Plus flavor) |
| Legal URLs live | https://stormpath2.netlify.app/privacy.html, `/terms.html`, `/support.html` all **200** |
| WeatherKit token function | https://stormpath2.netlify.app/.netlify/functions/weatherkit-token **200** |
| Bundle ID | `com.aaronpeck.stormpath` (not `com.stormpath.app`) |
| Marketing version | `4.20.5` |
| Customer env | `web/.env.production` omits `VITE_PAY_TIER` (Basic) and omits `VITE_PAY_TIER_TEST_PANEL` |
| Real AdMob IDs in repo | App ID `…~7029172303`, banner unit in `.env.production` |
| Export compliance flag | `ITSAppUsesNonExemptEncryption` = false |

What CI **cannot** prove: Subscribe sheet, Restore, ATT prompt, Basic ads, iPad layout, App Store Connect metadata, RevenueCat offerings, or sandbox purchase.

---

## Do not ship until these are true

### 1. Correct binary

- [ ] Customer IPA is **`appstore` track**, not a TestFlight Plus build.
- [ ] Trigger: GitHub → Actions → **iOS Build & TestFlight** → Run workflow → `build_track` = **`appstore`**.
- [ ] Confirm the run log says `Build track: appstore` and that `VITE_REVENUECAT_API_KEY_IOS` was present (the job **fails** if that secret is empty).
- [ ] Install that build from TestFlight and confirm About shows **Basic**, not Plus, on a fresh Apple ID with no subscription.

A Plus TestFlight IPA on the public listing would be a bait-and-switch rejection.

### 2. Merge or drop SiteBible ads

Open PR **#2** (`cursor/remove-sitebible-ad-bar-4ba7`) is **not** on `master`. Today’s Basic bar still ships:

> Coming Soon: SiteBible - Full Building Automation **Inventoy** Database

That is first-launch embarrassing. Merge it (or strip the copy) **before** the customer IPA.

### 3. Sandbox IAP on the Basic IPA (you, on a phone)

RevenueCat + Apple IAP is wired in code (`web/src/billing/revenueCat.ts`). Dashboard work is still only you.

On the **appstore** IPA, sandbox Apple ID:

- [ ] About → Subscription shows **Subscribe — $X.XX / …**, not “Loading…” and not the GitHub-secret developer sentence.
- [ ] Purchase unlocks Plus immediately (ads gone, Plus features on).
- [ ] Delete app → reinstall → **Restore purchases** unlocks Plus with no second charge.
- [ ] Cancel / manage opens Apple’s subscription page.

RevenueCat dashboard (must match code):

- [ ] App bundle id **`com.aaronpeck.stormpath`**
- [ ] Entitlement id exactly **`plus`**
- [ ] Products **`stormpath.plus.monthly`** and **`stormpath.plus.yearly`** imported and attached
- [ ] An offering marked **Current**
- [ ] iOS public SDK key `appl_…` is GitHub secret `VITE_REVENUECAT_API_KEY_IOS`

App Store Connect:

- [ ] Paid Applications agreement **Active**
- [ ] Subscription group + products **Ready to Submit** (or already submitted with the app)
- [ ] Localized display name + description on each product
- [ ] Price, duration, and intro offer (if any) match what you will put in the listing

### 4. Privacy / ads (reviewer-visible)

Code requests **App Tracking Transparency** before AdMob init (`web/src/ads/adMobClient.ts`).  
`PrivacyInfo.xcprivacy` still has **`NSPrivacyTracking` = false** and empty tracking domains.

Apple compares the ATT prompt, AdMob traffic, the privacy manifest, the App Privacy questionnaire, and https://stormpath2.netlify.app/privacy.html.

- [ ] Decide: personalized ads after ATT Allow, or always non-personalized.
- [ ] If you keep ATT + personalized ads: set `NSPrivacyTracking` true, add Google tracking domains, declare Device ID with tracking, and match App Store Connect **App Privacy**.
- [ ] Privacy policy currently names AdMob but **not** RevenueCat or Sentry. Add them (and Device ID / ATT) **and deploy** the HTML — Connect uses the live URL.
- [ ] Terms of Use have **no auto-renew subscription section**. Apple Guideline **3.1.2** expects duration, price, auto-renew, and cancel-in-Settings language in-app **and** in the EULA/terms. About today only says you can cancel at period end — too thin for review.

### 5. Listing (you in App Store Connect)

Screenshots (app runs on **iPhone and iPad** — `TARGETED_DEVICE_FAMILY = 1,2`):

- [ ] iPhone **6.9″** portrait: `1320×2868` (or `1290×2796` / `1260×2736`)
- [ ] iPad **13″** portrait: `2064×2752` (or `2048×2732`)
- [ ] Captions honest: if a shot shows Plus UI, say **StormPath Plus**. Description must say Basic is free and Plus is a subscription.

Also:

- [ ] Support URL + Privacy Policy URL (the Netlify pages above)
- [ ] Age rating
- [ ] App Privacy nutrition labels: precise location, diagnostics/crash (Sentry), identifiers if AdMob/ATT, search history if you declare it in the manifest
- [ ] Review notes: sandbox tester, path to Subscribe (About → Subscription), Restore steps (paste from [`STORE_READINESS_PLAN.md`](STORE_READINESS_PLAN.md) Phase 7)
- [ ] Background **location** + **audio** are in `Info.plist`. Review notes should say: location while navigating (including lock screen), audio for turn voice. Capacitor currently asks **While Using**, not Always — do not claim Always location in the questionnaire unless you actually request it.

### 6. Device smoke on the customer IPA

TestFlight testers have only seen **forced Plus**. The store binary is **Basic + ads + IAP**.

On iPhone (and once on iPad):

- [ ] Cold launch, location prompt, map, search, A/B/C, Go, Rt/Dr/Mp
- [ ] Basic: AdMob banner when **not** driving; **no** banner while Go/drive
- [ ] ATT prompt once on Basic (Allow and Don’t Track both still usable)
- [ ] Saved places cap (2) / saved routes cap (1)
- [ ] Subscribe → Plus; Restore after reinstall
- [ ] About has **no** “Test pay tier” panel
- [ ] Voice, radar, NWS life-safety on Basic vs full Plus map — matches listing copy
- [ ] iPad: usable, not a stretched iPhone mess

---

## Secrets (GitHub Actions)

This environment cannot list secret **values** (Actions secrets API is 403 here). Confirm in GitHub → Settings → Secrets:

**Signing / upload (already used by TestFlight):**  
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE`, `APPLE_TEAM_ID`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_CONTENT`

**Baked into the web bundle:**  
`VITE_MAPBOX_TOKEN`, `MAPBOX_DOWNLOADS_TOKEN`, `VITE_SENTRY_DSN`, `VITE_WEATHERKIT_ENABLED`, optional `VITE_TOMORROW_IO_*` / `VITE_OPENWEATHER_API_KEY`, optional `VITE_OPS_USAGE_INGEST_TOKEN`

**App Store track only (hard-required):**  
`VITE_REVENUECAT_API_KEY_IOS` (`appl_…` public SDK key — **not** the `sk_` secret key)

`REVENUECAT_SECRET_API_KEY` / `REVENUECAT_PROJECT_ID` are for Control Room / Netlify, not the phone SDK.

---

## Docs that are stale (do not treat as current)

| File | What’s wrong |
|------|----------------|
| [`STORE_READINESS_PLAN.md`](STORE_READINESS_PLAN.md) | Phase 1 still open for armv7 / AdMob test ID — **those are done**. Phase 7 still says dashboard work pending; RC key exists. Bundle id example `com.stormpath.app` is **wrong**. |
| [`BETA_READINESS.md`](BETA_READINESS.md) | Says automated tests = No. CI now runs **623** tests. IAP row is leftover from closed beta. |
| [`MOBILE_STORE_RELEASE.md`](MOBILE_STORE_RELEASE.md) | Still calls `storeEntitlement.ts` a StoreKit placeholder. RevenueCat already mirrors `plus` into that key. |
| [`PAY_TIERS.md`](PAY_TIERS.md) | Mentions Stripe / `VITE_UPGRADE_URL` as the upgrade path. Native Subscribe is the App Store path. Storm advisory copy vs About “NWS is Plus only” is inconsistent — listing must match **code**. |
| [`TESTER_NOTES.md`](TESTER_NOTES.md) | Advisory smoke still mentions SiteBible. |
| [`web/docs/IOS_APP_STORE.md`](../web/docs/IOS_APP_STORE.md) | Upload via `altool`; workflow now uses App Store Connect API + Transporter fallback. Missing `VITE_REVENUECAT_API_KEY_IOS`. |

Optional later (not launch blockers): TanStack Query, Live Activities, Capgo OTA, CarPlay, full AdMob SKAdNetwork list.

---

## Suggested order (avoid an embarrassing v1)

1. Merge SiteBible removal (PR #2) if you still want that gone.
2. Add subscription auto-renew language to `web/public/terms.html` + About Subscription, and RevenueCat/Sentry/ATT to `privacy.html`. Deploy those pages.
3. Align Privacy Manifest + App Privacy questionnaire with AdMob/ATT.
4. Run **appstore** track. Install that IPA. Sandbox Subscribe + Restore. iPhone + iPad smoke.
5. Screenshots from that Basic/Plus-honest set. Fill Connect. Submit.

Do **not** use a normal `master` push for the customer binary — that still builds **TestFlight Plus**.
