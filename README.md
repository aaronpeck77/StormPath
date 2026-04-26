# Route command center (greenfield)

**New to this?** Open [`START_HERE.md`](START_HERE.md) — step-by-step, no coding background required.

Driving-first, multi-route navigation with a **fused** situation layer (traffic, weather, hazards — radar/storm feeds to be wired next). Product intent: [`docs/NEXT_APP_VISION.md`](docs/NEXT_APP_VISION.md).

## Repos in this folder

| Path | Role |
|------|------|
| **`web/`** | Vite + React — Mapbox map, OpenRouteService polylines, OpenWeather hints, mock radar/hazards. Best for rapid UI iteration. |
| **`mobile/`** | Expo + React Native + **@rnmapbox/maps** — iOS/Android shell aimed at **CarPlay / Android Auto** later. Requires a **dev build** (not Expo Go). |

## Your keys (local only)

1. **`web/.env`** — copy from [`web/.env.example`](web/.env.example):

   - `VITE_MAPBOX_TOKEN`
   - `VITE_ORS_API_KEY` (OpenRouteService)
   - `VITE_OPENWEATHER_API_KEY`

2. **`mobile/.env`** — copy from [`mobile/.env.example`](mobile/.env.example):

   - `EXPO_PUBLIC_MAPBOX_TOKEN`

3. **Mapbox downloads token** (secret, `DOWNLOADS:READ`) — paste into `mobile/app.json` → `@rnmapbox/maps` → `RNMapboxMapsDownloadToken` (replace placeholder). Needed for native SDK install during `expo prebuild`.

Never commit `.env` files. For production, **do not** expose ORS/OpenWeather keys in the mobile app; use a small backend proxy.

## Run web

```bash
cd web
npm install
npm run dev
```

**iOS (Capacitor) — TestFlight & App Store:** the Xcode project is under `web/ios/`. Full checklist: [`web/docs/IOS_APP_STORE.md`](web/docs/IOS_APP_STORE.md) (signing, GitHub Actions, App Store Connect).

With `VITE_ORS_API_KEY` set, the app replaces mock geometry with **three ORS routes** between demo start/end (see `App.tsx`). With OpenWeather set, **forecast text and precip hint** feed the fuse panel; traffic/incident/radar tiles remain mocked until those adapters exist.

## Run mobile

See [`mobile/README.md`](mobile/README.md): `expo prebuild` → `expo run:ios` / `run:android`.

## Next build steps

- Geolocation + user destination (replace demo coordinates).
- Backend proxy for ORS + OpenWeather + future radar/storm APIs.
- Mapbox Traffic / incidents (or another traffic source) into the same `FusedSituationSnapshot` model.
- CarPlay / Android Auto templates once the RN drive experience is stable.
