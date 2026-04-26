# StormPath — iOS App Store (Capacitor)

The native shell lives under **`web/ios/`** (Xcode project). Bundle ID is set in [`capacitor.config.ts`](../capacitor.config.ts) (`appId`, currently `com.aaronpeck.stormpath`) and must match App Store Connect and your provisioning profile.

## What you need from Apple

1. **Apple Developer Program** membership (paid).
2. **App ID** in [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) matching `appId`.
3. **Distribution certificate** (.p12) and **App Store provisioning profile** for that App ID.
4. **App Store Connect**: create the app record (same bundle ID), fill **Privacy**, **Age Rating**, **Export Compliance** (encryption: StormPath sets `ITSAppUsesNonExemptEncryption` false in `Info.plist` — confirm for your build).
5. **App Store Connect API key** (.p8) for CI upload — *Users and Access* → *Keys* → *App Store Connect API*.

## GitHub Actions → TestFlight

Workflow: [`.github/workflows/ios-build.yml`](../../.github/workflows/ios-build.yml) (runs on `main` / `master` and manual *workflow_dispatch*).

Configure these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|--------|---------|
| `VITE_MAPBOX_TOKEN` | Baked into the web build at compile time |
| `APPLE_CERTIFICATE` | Base64 of distribution `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Export password for the `.p12` |
| `APPLE_PROVISIONING_PROFILE` | Base64 of App Store `.mobileprovision` |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `APP_STORE_CONNECT_API_KEY_ID` | Key ID from the .p8 |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID (same page) |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | Full `.p8` PEM or base64 (see [`.github/scripts/write-appstore-connect-key.py`](../../.github/scripts/write-appstore-connect-key.py)) |

A successful run produces an **IPA** artifact and uploads to **TestFlight** via `xcrun altool`. Install the build in **TestFlight**, smoke-test, then in App Store Connect click **Submit for Review** when ready.

## Local build (optional)

From the `web` folder:

```bash
npm ci
npm run build:ios
```

Open `web/ios/App/App.xcodeproj` in Xcode, pick a team/signing, **Product → Archive**, then **Distribute App** if you are not using CI.

## Version numbers

- **Marketing version** (`CFBundleShortVersionString`): set in Xcode (or the project) to match what you want users to see (e.g. `0.8.0`).
- **Build number** (`CFBundleVersion`): the workflow runs `agvtool new-version -all ${{ github.run_number }}` so every CI run gets a unique build.

## Before “Submit for Review”

- [ ] Real device test: location, map, navigation, advisory bar, background location if you claim it.
- [ ] **App Privacy** questionnaire in App Store Connect matches data you collect (location, etc.).
- [ ] Screenshots and description for the required device sizes.
- [ ] **Support URL** and privacy policy URL (you can use site pages; `env` has optional `VITE_PRIVACY_POLICY_URL` / `VITE_SUPPORT_URL` for the web app’s About flow).

If anything in signing or upload fails, open the workflow log and search for `error:` from `xcodebuild` or `altool`.
