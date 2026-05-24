# TestFlight from Windows — GitHub Actions only (no Mac)

You **do not need a Mac** if this workflow is set up. GitHub runs the build on Apple’s Mac in the cloud, signs the app, and uploads to TestFlight.

**Repo:** `aaronpeck77/StormPath`  
**Workflow file:** [`.github/workflows/ios-build.yml`](../.github/workflows/ios-build.yml)  
**Runs when:** you push to **`main`** or **`master`**, or you click **Run workflow** manually.

---

## Your day-to-day loop (Windows)

1. **Edit code** in Cursor on your PC (optional: `cd web && npm run dev` to try in Chrome).
2. **Commit and push** to GitHub on branch **`master`** (or `main`):

   ```bash
   git add -A
   git commit -m "Describe what changed"
   git push origin master
   ```

3. **Wait for GitHub** — open the repo in a browser:
   - **Actions** tab → workflow **“iOS Build & TestFlight”**
   - Yellow dot = running, green check = success, red X = failed (open the run and search the log for `error:`)

4. **TestFlight on your iPhone** (after a green build, then Apple processing in App Store Connect):
   - Green GitHub means the IPA was **uploaded** to Apple (~2 min). Apple still needs **10–30+ min** to process before it appears on your phone.
   - Install Apple’s **TestFlight** app
   - Open StormPath → pull down to refresh → tap **Update** when build **100+** appears
   - Check [App Store Connect](https://appstoreconnect.apple.com) → **TestFlight** if the phone doesn’t update after 30 min

5. **Invite testers** — [App Store Connect](https://appstoreconnect.apple.com) in any browser (no Mac):
   - Your app → **TestFlight** → add internal/external testers
   - Paste **What to Test** text from [`TESTER_NOTES.md`](TESTER_NOTES.md)

That’s the whole pipeline you’ve been using: **push → Actions → TestFlight**.

---

## What GitHub does on each push (automatic)

| Step | What happens |
|------|----------------|
| 1 | Checks out your code |
| 2 | `npm ci` in `web/` |
| 3 | TypeScript check |
| 4 | **`npm run build:testflight`** — bakes in API keys from **Secrets** + Plus/support from **`.env.testflight`** |
| 5 | `cap sync ios` — copies web build into the Xcode project |
| 6 | Xcode archive + sign (certificate + provisioning profile from Secrets) |
| 7 | Export `.ipa` |
| 8 | Upload to **TestFlight** (App Store Connect API key) |
| 9 | Saves `.ipa` as a downloadable **Artifact** (14 days) if you need it |

Build number = GitHub run number (always increases).

---

## Secrets you need (one-time setup)

**GitHub → your repo → Settings → Secrets and variables → Actions → Repository secrets**

| Secret name | What it is |
|-------------|------------|
| `VITE_MAPBOX_TOKEN` | Mapbox public token (`pk.…`) |
| `VITE_TOMORROW_IO_API_KEY` | Tomorrow.io (forecasts / minute precip) |
| `VITE_OPENWEATHER_API_KEY` | OpenWeather (nowcast / route weather) |
| `APPLE_CERTIFICATE` | Base64 of your **distribution** `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_PROVISIONING_PROFILE` | Base64 of App Store **`.mobileprovision`** |
| `APPLE_TEAM_ID` | 10-character Apple Team ID |
| `APP_STORE_CONNECT_API_KEY_ID` | App Store Connect API key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID (same Keys page) |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | Contents of the `.p8` file (PEM or base64) — key must have **App Manager** access (Developer-only keys can upload but get **401** when checking build status) |
| `VITE_SENTRY_DSN` | Sentry DSN for automatic crash reports ([`SENTRY_SETUP.md`](SENTRY_SETUP.md)) — **recommended** |

You said API/signing secrets are already set — if builds were reaching TestFlight before, you’re good. Add `VITE_SENTRY_DSN` when ready (app works without it).  
If a build **suddenly** fails on signing, the **certificate or profile may have expired** (renew in Apple Developer, re-export `.p12` / profile, update the two APPLE_* secrets).

You **cannot** view secret values again in GitHub; you can only update them.

---

## Re-run a build without changing code

GitHub → **Actions** → **iOS Build & TestFlight** → **Run workflow** → branch **master** → **Run workflow**.

Use this after fixing a secret or when Apple didn’t pick up a build.

---

## If a build fails

1. Open the failed run → expand the first red step.
2. Common fixes:
   - **Missing secret** — log mentions empty env; add/update secret.
   - **Signing** — `code sign`, `provisioning`, `certificate`; refresh `.p12` + profile in Secrets.
   - **Xcode / SDK** — workflow selects Xcode 26; if GitHub’s image changes, see workflow step “Select Xcode 26”.
   - **Mapbox / API** — map blank in TestFlight but build succeeded → check `VITE_MAPBOX_TOKEN` secret.
   - **Green GitHub, phone still on old build (#99)** — common after the rainbow icon: **RGBA / oversized PNG** passes CI but Apple rejects during processing. Workflow now validates **opaque RGB** icons. Also check **App Store Connect → StormPath → TestFlight → iOS Builds** (version **1.0.1**):
     - **Missing** → upload never reached Apple; re-run workflow and check the upload log.
     - **Processing** → wait (can take 30+ min).
     - **Missing Compliance** → tap build → answer export compliance (should be auto with `ITSAppUsesNonExemptEncryption=false`).
     - **Invalid / Failed** → open the build for Apple’s email/reason (icon, signing, etc.).
     - **Ready to Test** but phone stuck on 99 → TestFlight app → pull down to refresh; confirm **Internal Testing** group has the new build enabled.
   - **401 NOT_AUTHORIZED on upload step** — API key needs **App Manager** (or Admin) role in App Store Connect → Users and Access → Keys. Developer-only keys can upload but cannot poll build status.
   - **Upload / API key** — `DECODER routines::unsupported` means the `.p8` secret isn’t valid PEM for Node. The workflow normalizes it automatically; if it still fails, re-save **`APP_STORE_CONNECT_API_KEY_CONTENT`** as the full `.p8` file text (including `BEGIN`/`END` lines) or one line of base64 of that whole file.
3. Optional: download **Artifacts** → `StormPath-###.ipa` from a successful run for debugging.

---

## What you never need for this path

- Owning or renting a Mac for routine releases  
- `npm run build:ios:testflight` on your PC (Windows can’t run Xcode archive anyway)  
- Putting API keys in committed files (only **Secrets** + committed `.env.testflight` for non-secret TestFlight settings)

---

## Beta checklist (GitHub-only)

- [ ] Push latest code to **`master`**
- [ ] Actions run **green**
- [ ] New build in **TestFlight** on your iPhone
- [ ] Smoke test ([`TESTER_NOTES.md`](TESTER_NOTES.md)) on the phone
- [ ] Update **What to Test** in App Store Connect
- [ ] Invite testers

More detail: [`BETA_READINESS.md`](BETA_READINESS.md) · [`web/docs/IOS_APP_STORE.md`](../web/docs/IOS_APP_STORE.md)
