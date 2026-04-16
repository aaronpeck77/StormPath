# Mobile — iOS & Android

This app uses **[Mapbox Maps SDK via `@rnmapbox/maps`](https://github.com/rnmapbox/maps)**. Mapbox **does not run inside Expo Go**; you need a **development build** or **release build** after `expo prebuild`.

## Prerequisites

1. **Mapbox access token** (same account as web) — `EXPO_PUBLIC_MAPBOX_TOKEN` in `.env`.
2. **Mapbox downloads token** (secret, `DOWNLOADS:READ`) — required for the native SDK install step. Put it in `app.json` → `plugins` → `@rnmapbox/maps` → `RNMapboxMapsDownloadToken` (replace the placeholder string). See [Mapbox — iOS install](https://docs.mapbox.com/ios/maps/guides/install/) / Android equivalent.
3. **RevenueCat iOS public API key** — `EXPO_PUBLIC_RC_APPLE_API_KEY`.
4. **RevenueCat entitlement id** — `EXPO_PUBLIC_RC_ENTITLEMENT_ID` (default `pro`).
5. Optional QA-only toggle: `EXPO_PUBLIC_PRO_ENTITLED=true` to force Pro on local builds.
6. **Premium data (Pro + feature toggles):**
   - **Weather Routing:** set `EXPO_PUBLIC_STORMPATH_API_BASE` to your API origin (no trailing slash). The app calls `GET {base}/api/v1/weather/current?lat={lat}&lon={lng}` and expects JSON `{ "headline": string, "precipHint"?: number }`. Optional header `Authorization: Bearer {EXPO_PUBLIC_STORMPATH_API_KEY}` if your proxy requires it. For local dev only you can use `EXPO_PUBLIC_OPENWEATHER_API_KEY` instead of the backend (key ships in the client — not ideal for production).
   - **Hazard Guidance:** uses US National Weather Service `alerts/active?point=lat,lon` with `User-Agent` from `EXPO_PUBLIC_NWS_USER_AGENT` (set a real contact per NWS policy).
   - **Traffic Bypass Compare:** uses Mapbox `driving-traffic` directions for a short sample leg (same public Mapbox token as the map).

## Commands

```bash
cd mobile
npm install
# copy .env.example → .env and fill EXPO_PUBLIC_MAPBOX_TOKEN
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

Then `npx expo start --dev-client` for day-to-day dev.

## Free + Pro model

- The app is configured as one binary with feature gating:
  - Free users get the base map experience.
  - Pro users unlock premium features when entitlement is true.
- Premium-gated controls now enforce behavior in-app:
  - `Weather Routing`
  - `Hazard Guidance`
  - `Traffic Bypass Compare`
- Free users can see these controls but cannot toggle them on (locked state).
- With Pro and a toggle on, the app performs the matching **network request** (debounced on map move) and shows results in **Premium data** (plus **Refresh**).
- Billing is wired through **RevenueCat**:
  - `Upgrade in app` purchases the current package from RevenueCat offerings.
  - `Restore purchases` restores App Store purchases and re-checks entitlement.
- Keep `EXPO_PUBLIC_PRO_ENTITLED=false` in production builds; use real StoreKit entitlements.

## RevenueCat + App Store setup

1. In App Store Connect, create your in-app purchase product(s) (subscription or non-consumable).
2. In RevenueCat, add the app and connect App Store credentials.
3. Create entitlement `pro` (or your chosen id).
4. Create offering with at least one package mapped to your App Store product id.
5. Set `EXPO_PUBLIC_RC_APPLE_API_KEY` and `EXPO_PUBLIC_RC_ENTITLEMENT_ID` in `mobile/.env`.
6. Run:
   - `npm install`
   - `npx expo prebuild`
   - `npx expo run:ios`

## App Store readiness checklist

- Remove all debug/demo copy before shipping (done in current mobile shell).
- Confirm no secret keys are hardcoded in source control.
- Verify purchase + restore with Apple sandbox test accounts.
- Set App Privacy and account deletion details in App Store Connect before submit.
