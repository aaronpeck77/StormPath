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

## Update the live site

1. Double-click `web/BUILD_FOR_NETLIFY.bat` on Windows (runs `build:netlify`, which verifies `_headers` and icons).
2. Netlify → site **stormpath2** → **Deploys** → drag the folder the script opens (not an old copy from a previous run).
3. Confirm https://stormpath2.netlify.app/_deploy-check.txt shows `csp_tomorrow_io=yes`.
4. Hard-refresh the app and confirm the console no longer blocks `api.tomorrow.io`.

### CSP still wrong after deploy?

Netlify can apply **duplicate** Content-Security-Policy from the site dashboard. Those override `_headers` in your uploaded folder.

1. Netlify → **stormpath2** → **Site configuration** → **HTTP headers**
2. If **Content-Security-Policy** is listed there, **delete** it (or add `https://api.tomorrow.io` to `connect-src`)
3. Redeploy using `BUILD_FOR_NETLIFY.bat` again

On the deploy details page, Netlify should report that header rules were processed. You can also download the deploy zip and confirm `_headers` contains `api.tomorrow.io`.

Code default for these URLs: `web/src/config/publicSite.ts`.

## Mapbox token

If you restrict the Mapbox token by URL, include:

`https://stormpath2.netlify.app/*`

(TestFlight uses the native app, not this domain, for map loads.)
