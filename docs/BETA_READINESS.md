# Beta readiness — closed TestFlight

One checklist for **you** before sending invites. Testers use [`TESTER_NOTES.md`](TESTER_NOTES.md).

**Target:** 5–15 people, iOS TestFlight, Plus enabled on the build (not real billing yet).

**No Mac?** Use GitHub only: [`GITHUB_TESTFLIGHT_ONLY.md`](GITHUB_TESTFLIGHT_ONLY.md) — push to `master` → Actions → TestFlight.

---

## Status at a glance

| Area | Ready? | Notes |
|------|--------|--------|
| Core navigation (search → A/B/C → Go → drive) | Yes | Smoke on device each build |
| Route compare (map + Go) | Yes | Three end-to-end variants from current position |
| Search bar dismiss (×) | Yes | Collapses to destination chip when trip loaded |
| Support + diagnostics email | Yes | `stormpath@yahoo.com` in `.env.testflight` |
| Privacy / terms / support pages | Yes | Bundled; URLs in testflight env |
| NWS User-Agent (TestFlight) | Yes | Set in `.env.testflight` |
| Plus on TestFlight build | Yes | `VITE_PAY_TIER=plus` in testflight mode |
| Demo tools in TF/production | Hidden | `?demo=bypass` only when `import.meta.env.DEV` |
| IAP / App Store billing | No | OK for closed beta; document in tester notes |
| Crash reporting (Sentry, etc.) | No | Use support email + screenshots for now |
| Automated tests | No | Manual smoke only |
| Android closed test | Optional | iOS-first is fine |

---

## Phase 1 — You (before any invite)

### A. Keys and build env (~15 min)

**You do not need to own a Mac.** iOS builds require *some* macOS + Xcode somewhere — either your **rented cloud Mac**, **GitHub Actions** (free Mac runner in the cloud), or both. Day-to-day coding on Windows is fine.

Do this on **whatever machine runs the archive** (rented Mac or CI only):

- [ ] **`web/.env.local`** (gitignored) has real keys:
  - [ ] `VITE_MAPBOX_TOKEN` (public token; URL restrictions include your app origin / Capacitor if needed)
  - [ ] `VITE_OPENWEATHER_API_KEY` (recommended — route weather + nowcast)
  - [ ] `VITE_TOMORROW_IO_API_KEY` (optional — minute precip + hourly; note quota in tester limitations if omitted)
- [ ] **Mapbox dashboard:** budget alert set; token not restricted in a way that breaks the iOS WebView.
- [ ] **Support inbox** `stormpath@yahoo.com` monitored (or change `VITE_SUPPORT_EMAIL` in `.env.testflight` and rebuild).

Committed **`web/.env.testflight`** already sets Plus, support URLs, NWS User-Agent, and internal pay-tier test panel. Do **not** use testflight mode for App Store *customer* builds.

### B. Build and upload (~30–60 min)

Pick **one** path:

**Path 1 — Rented cloud Mac (what you use today)**  
On the rented Mac, with this repo cloned and `web/.env.local` filled (or keys in GitHub Secrets if you only build via CI):

```bash
cd web
npm ci
npm run build:ios:testflight
```

Open `web/ios/App/App.xcodeproj` in Xcode → **Product → Archive** → **Distribute** → TestFlight.

**Path 2 — No Mac at all (GitHub Actions)**  
Push to `main` / `master` or run **Actions → iOS Build & TestFlight → Run workflow**.  
Requires Apple signing secrets + API keys in GitHub (see [`web/docs/IOS_APP_STORE.md`](../web/docs/IOS_APP_STORE.md)).  
The workflow uses `npm run build:testflight` and uploads to TestFlight automatically.

**Path 3 — Windows only**  
`npm run dev` for testing in the browser; **cannot** produce an iPhone IPA without Path 1 or 2.

- [ ] Build number bumped (Xcode or CI `agvtool`).
- [ ] Install the build on **your** iPhone from TestFlight before inviting others (needs **any** iPhone + TestFlight app — not a Mac).

### C. Device smoke pass (~20 min)

Run every item on the **TestFlight IPA** (not only `npm run dev`). Full list: [`TESTER_NOTES.md` § For you](TESTER_NOTES.md#for-you--before-each-testflight-invite-round).

**Add for this release:**

- [ ] Open address bar → tap **×** → collapses to destination chip (not stuck open).
- [ ] With a trip running: hazard or advisory → **Compare routes on map** → three **different** lines → tap A/B/C (line highlights) → **Go** → returns to drive on chosen route.

If anything fails, fix and rebuild — do not invite on a broken build.

### D. App Store Connect (~10 min)

- [ ] **TestFlight → What to Test** — paste updated blurb (template in `TESTER_NOTES.md`; mention compare routes + search ×).
- [ ] **Internal testing** group: add yourself first, then external testers when smoke passes.
- [ ] **Export compliance / encryption** — already declared in project; confirm unchanged if Apple asks.

### E. Tester comms

- [ ] Send testers a one-liner: install TestFlight, accept invite, read “What to Test.”
- [ ] Point them to **report via** `i` → Support diagnostics → Email (or screenshot to you).
- [ ] Set expectations: US NWS only, Plus on this build, no real subscription checkout, weather can lag ~10 min.

---

## Phase 2 — During beta (first 2 weeks)

| Task | Owner | Done |
|------|--------|------|
| Triage feedback (spreadsheet or GitHub issues `beta`) | You | [ ] |
| Watch Mapbox / Tomorrow.io / OpenWeather usage | You | [ ] |
| One **Basic** build smoke (`npm run build:ios`, no testflight mode) | You | [ ] |
| Fix top 3 crashers / “feels broken” themes | Dev | [ ] |
| Optional: add crash reporter (Sentry / Firebase) | Dev | [ ] |

---

## Phase 3 — Not required for closed beta (before public App Store)

- [ ] StoreKit / Play Billing → `setNativePlusEntitlementActive` ([`storeEntitlement.ts`](../web/src/billing/storeEntitlement.ts))
- [ ] `VITE_UPGRADE_URL` / manage subscription URLs that work
- [ ] Turn **off** `VITE_PAY_TIER_TEST_PANEL` in customer binaries
- [ ] App Store screenshots, privacy questionnaire, age rating
- [ ] Optional API proxy so keys are not only in the client

---

## Quick commands

| Goal | Command |
|------|---------|
| Local dev | `cd web && npm run dev` |
| TestFlight-shaped web bundle | `npm run build:testflight` |
| TestFlight IPA prep | `npm run build:ios:testflight` |
| Retail / Basic-shaped build | `npm run build:ios` |

---

## Related docs

- [`TESTER_NOTES.md`](TESTER_NOTES.md) — smoke checklist + copy for testers
- [`DEV_AND_TESTFLIGHT_WORKFLOW.md`](DEV_AND_TESTFLIGHT_WORKFLOW.md) — dev vs TF vs App Store tiers
- [`MOBILE_STORE_RELEASE.md`](MOBILE_STORE_RELEASE.md) — IAP and store review
- [`PAY_TIERS.md`](PAY_TIERS.md) — Basic vs Plus features
