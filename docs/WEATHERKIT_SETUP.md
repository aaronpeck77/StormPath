# Apple WeatherKit setup (StormPath)

WeatherKit replaces Tomorrow.io / OpenWeather for route and point forecasts at App Store scale.
The app never holds your Apple private key — a tiny Netlify function signs short-lived JWTs.

## 1. Apple Developer (you did this)

- **App ID** `com.aaronpeck.stormpath` → enable **WeatherKit** capability (portal only — required for API access)
- **Services ID** `com.aaronpeck.stormpath.weatherkit`
- **Key** with WeatherKit enabled → download `.p8` once, note **Key ID**
- **Team ID** (e.g. `8Y86R5V45T`)

The iOS app uses WeatherKit **REST** via a Netlify JWT token — no WeatherKit entitlement is baked into the IPA, so you do **not** need to regenerate your provisioning profile for WeatherKit.

## 2. Netlify environment variables

Netlify → **stormpath2** → Site configuration → Environment variables:

| Variable | Value |
|----------|--------|
| `WEATHERKIT_TEAM_ID` | Your Team ID |
| `WEATHERKIT_KEY_ID` | Key ID from the .p8 page |
| `WEATHERKIT_SERVICE_ID` | `com.aaronpeck.stormpath.weatherkit` |
| `WEATHERKIT_PRIVATE_KEY` | Full `.p8` PEM; paste with `\n` for line breaks |

## 3. Deploy from Git (required for functions)

**Drag-and-drop `dist/` does not deploy serverless functions.**

Connect the GitHub repo in Netlify (or use `netlify deploy --build` from CLI).
`netlify.toml` builds `web/` and bundles `web/netlify/functions/weatherkit-token`.

Verify after deploy:

```
https://stormpath2.netlify.app/.netlify/functions/weatherkit-token
```

Should return JSON: `{ "token": "...", "expiresAtMs": ... }`

## 4. App build flag

In `web/.env.local` (dev) and GitHub Actions / TestFlight secrets:

```
VITE_WEATHERKIT_ENABLED=true
```

When enabled, Tomorrow.io and OpenWeather keys are ignored for forecasts (NWS + radar unchanged).

Optional override for the token URL (native app default is stormpath2):

```
VITE_WEATHERKIT_TOKEN_URL=https://stormpath2.netlify.app/.netlify/functions/weatherkit-token
```

## 5. TestFlight / iOS build

Add to GitHub repo secret or `.env.testflight`:

```
VITE_WEATHERKIT_ENABLED=true
```

Rebuild IPA. Boot log should show `weatherKit: YES`.
