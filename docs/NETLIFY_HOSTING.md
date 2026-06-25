# Netlify hosting (legal pages + optional web app)

StormPath’s public static site on Netlify:

| | |
|--|--|
| **Site name** (Netlify dashboard) | `stormpath2` |
| **URL** | https://stormpath2.netlify.app |
| **Privacy** | https://stormpath2.netlify.app/privacy.html |
| **Terms** | https://stormpath2.netlify.app/terms.html |
| **Support** | https://stormpath2.netlify.app/support.html |

Source files live in `web/public/` and are copied into `web/dist/` on build.

## TestFlight vs Netlify

- **TestFlight / iPhone app** does not require Netlify — legal pages are bundled in the IPA.
- **App Store Connect** listing needs the **https** URLs above for Privacy Policy and Support.
- **Free Netlify tier** is enough for these static pages.

## Update the live site (Git — required for WeatherKit functions)

1. Connect the GitHub repo in Netlify → **Build & deploy** → **Continuous deployment**.
2. Confirm settings match `netlify.toml`: base **`web`**, command **`npm run build:netlify`**, publish **`dist`**, functions **`netlify/functions`** (under `web/`).
3. Add **build** environment variables (Site configuration → Environment variables):
   - **`VITE_MAPBOX_TOKEN`** — your Mapbox public token. Scope: **Builds**. Use **same value in all deploy contexts** (Production + Deploy Previews).
   - **`VITE_WEATHERKIT_ENABLED`** = `true` (optional until token URL works). Scope: **Builds**.
4. WeatherKit signing vars (`WEATHERKIT_*`) — scope **Functions** (and Builds if Netlify requires it for secrets).
5. **Trigger deploy** after changing env vars (Deploys → Deploy project).
6. Confirm https://stormpath2.netlify.app/_deploy-check.txt shows a fresh `built_at=` timestamp and `csp_weatherkit=yes`.
7. Confirm https://stormpath2.netlify.app/.netlify/functions/weatherkit-token returns JSON (not “page not found”).

### Legacy drag-and-drop (static site only — no serverless functions)

1. Double-click `web/BUILD_FOR_NETLIFY.bat` on Windows (runs `build:netlify`, which verifies `_headers` and icons).
2. Netlify → site **stormpath2** → **Deploys** → drag the folder the script opens (not an old copy from a previous run).
3. Confirm https://stormpath2.netlify.app/_deploy-check.txt shows `csp_tomorrow_io=yes`.
4. Hard-refresh the app and confirm the console no longer blocks `api.tomorrow.io`.

**Drag-and-drop cannot deploy `weatherkit-token`** — use Git-connected deploy for WeatherKit.

### CSP still wrong after deploy?

Netlify can apply **duplicate** Content-Security-Policy from the site dashboard. Those override `_headers` in your uploaded folder.

1. Netlify → **stormpath2** → **Site configuration** → **HTTP headers**
2. If **Content-Security-Policy** is listed there, **delete** it (or add `https://api.tomorrow.io` to `connect-src`)
3. Redeploy using `BUILD_FOR_NETLIFY.bat` again

On the deploy details page, Netlify should report that header rules were processed. You can also download the deploy zip and confirm `_headers` contains `api.tomorrow.io`.

Code default for these URLs: `web/src/config/publicSite.ts`.

## Map radar tiles (App Store scale)

Native US radar uses a **Tomorrow.io tile proxy** (WKWebView CORS). For thousands of users, deploy the **Cloudflare Worker** in `cloudflare/tomorrow-io-tiles/` and set `VITE_TOMORROW_IO_TILE_PROXY_URL` in iOS builds. Step-by-step: **[`CLOUDFLARE_TILES.md`](CLOUDFLARE_TILES.md)**.

The Netlify function `tomorrow-io-tile` remains a valid fallback until Cloudflare is configured.

## Mapbox token

If you restrict the Mapbox token by URL, include:

`https://stormpath2.netlify.app/*`

(TestFlight uses the native app, not this domain, for map loads.)
