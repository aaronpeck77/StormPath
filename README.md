# Route command center (greenfield)

**New to this?** Open [`START_HERE.md`](START_HERE.md) — step-by-step, no coding background required.

**Closed beta?** No Mac: [`docs/GITHUB_TESTFLIGHT_ONLY.md`](docs/GITHUB_TESTFLIGHT_ONLY.md) · Netlify: [`docs/NETLIFY_HOSTING.md`](docs/NETLIFY_HOSTING.md) · Checklist: [`docs/BETA_READINESS.md`](docs/BETA_READINESS.md) · Crashes: [`docs/SENTRY_SETUP.md`](docs/SENTRY_SETUP.md) · Testers: [`docs/TESTER_NOTES.md`](docs/TESTER_NOTES.md).

Driving-first, multi-route navigation with a **fused** situation layer (traffic, weather, hazards — radar/storm feeds to be wired next). Product intent: [`docs/NEXT_APP_VISION.md`](docs/NEXT_APP_VISION.md).

## Repos in this folder

| Path | Role |
|------|------|
| **`web/`** | Vite + React — Mapbox map + directions + traffic, weather/radar adapters, drive UI. Best for rapid UI iteration. |
| **`mobile/`** | Expo + React Native + **@rnmapbox/maps** — iOS/Android shell aimed at **CarPlay / Android Auto** later. Requires a **dev build** (not Expo Go). |

## Your keys (local only)

1. **`web/.env`** — copy from [`web/.env.example`](web/.env.example):

   - `VITE_MAPBOX_TOKEN` (required)
   - Optional weather keys — see `web/.env.example` (OpenWeather, Tomorrow.io, WeatherKit)

2. **`mobile/.env`** — copy from [`mobile/.env.example`](mobile/.env.example):

   - `EXPO_PUBLIC_MAPBOX_TOKEN`

3. **Mapbox downloads token** (secret, `DOWNLOADS:READ`) — paste into `mobile/app.json` → `@rnmapbox/maps` → `RNMapboxMapsDownloadToken` (replace placeholder). Needed for native SDK install during `expo prebuild`.

Never commit `.env` files. For production, **do not** expose weather API keys in the mobile app without a backend proxy where required.

## Run web

```bash
cd web
npm install
npm run dev
```

**iOS (Capacitor) — TestFlight & App Store:** the Xcode project is under `web/ios/`. Full checklist: [`web/docs/IOS_APP_STORE.md`](web/docs/IOS_APP_STORE.md) (signing, GitHub Actions, App Store Connect).

With `VITE_MAPBOX_TOKEN` set, Mapbox builds **multi-route trips** with live traffic ETAs. Weather, radar, and NWS alerts load when their adapters are configured — see `web/.env.example`.

## Run mobile

See [`mobile/README.md`](mobile/README.md): `expo prebuild` → `expo run:ios` / `run:android`.

## Next build steps

- Geolocation + user destination (replace demo coordinates).
- Backend proxy for weather keys where App Store policy requires it (WeatherKit JWT, Tomorrow.io tiles — partially done via Netlify/Cloudflare).
- Mapbox Traffic / incidents (or another traffic source) into the same `FusedSituationSnapshot` model.
- CarPlay / Android Auto templates once the RN drive experience is stable.
