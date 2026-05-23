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

1. Double-click `web/BUILD_FOR_NETLIFY.bat` on Windows.
2. Netlify → site **stormpath2** → **Deploys** → drag the folder the script opens.
3. Confirm the three URLs in a browser.

Code default for these URLs: `web/src/config/publicSite.ts`.

## Mapbox token

If you restrict the Mapbox token by URL, include:

`https://stormpath2.netlify.app/*`

(TestFlight uses the native app, not this domain, for map loads.)
