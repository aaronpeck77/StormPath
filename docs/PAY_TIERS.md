# StormPath web — Basic vs Plus

Single source of truth for what ships in each tier. Code gates live in `web/src/billing/payFeatures.ts` (and env for a few toggles).

## Basic (free)

Full navigation with ads and a compact local nowcast — no corridor weather stack:

| Area | Included |
|------|----------|
| **Map & routing** | Multi-route (A/B/C), Mapbox directions + live traffic, fit/follow, route view / drive / topdown |
| **Search & destination** | Autocomplete, geocode, set destination, trip planning |
| **Driving** | Turn-by-turn banner, bottom toolbar, reroute / off-route flows |
| **Saved** | Saved places (★) and routes with Basic caps (`BASIC_MAX_SAVED_*` in `payFeatures.ts`) |
| **Local nowcast** | Current conditions on the advisory banner + compact expanded panel (`hasLocalForecast()`). **No** 24h hourly, 7-day, or NWS location-alert list on that page |
| **Ads** | Partner “Advertisement” slot on the expanded Basic advisory; AdMob banner when idle, and again while navigating if the advisory panel is open |
| **Sparse tips** | Occasional nearby POI one-liners in the banner rotator (throttled Search Box) |

## Plus (paid)

| Feature | Notes |
|---------|--------|
| **Corridor / NWS** | Active-alert polygons, advisory corridor strip, life-safety + route hazard detail |
| **Local forecast (full)** | Hourly (24h), multi-day outlook, minute precip, NWS alerts near you on the advisory page |
| **Route progress rail** | Right-edge strip while navigating (progress, radar/traffic/hazard ticks). Gated on `isPlus` |
| **Traffic overlay & road detail** | Mapbox traffic corridor tools and road-impact rows when About toggles allow |
| **Toll bypass** | Toll warning sheet + toll-free alternate compare (`hasTollBypass()`) |
| **Frequent route learning** | Device-local trip detection / suggestions (`hasFrequentRoutesLearning()`) |
| **No AdMob** | Plus does not show the Basic AdMob / partner ad chrome |

## Subscription links (About sheet)

The About → **Subscription** section can show:

- **Upgrade to Plus** — only when the effective tier is Basic. Set `VITE_UPGRADE_URL` to your checkout or App Store app URL (e.g. `https://apps.apple.com/app/id…`).
- **Manage subscription** — set `VITE_MANAGE_SUBSCRIPTION_URL`. Default in `.env.example`: Apple’s subscription management page (`https://apps.apple.com/account/subscriptions`). Use your Stripe Customer Portal or account URL if you bill outside the App Store.

These are build-time env vars (`web/.env` or hosting dashboard). Rebuild after changing them.

## Version & About

**Version** and **Basic / Plus** appear in the **About** sheet: small **“i”** button on the **map** (bottom-left, above bottom chrome). Sheet: `ui/AboutSheet.tsx`. Version from `web/package.json` via Vite `__APP_VERSION__` in `vite.config.ts`.

## Development vs production

- **`npm run dev` / Capacitor live reload (`import.meta.env.DEV`):** `getPayTier()` returns **Plus** by default so you can verify Plus behavior without env keys.
- **Test Basic in dev:** About → **Test pay tier** → Basic, or `localStorage.setItem("stormpath-pay-tier-override","free")` then reload. Clear override with `removeItem("stormpath-pay-tier-override")` to go back to dev-default Plus.
- **Production build (`vite build`, App Store / Play):** tier is **Basic** unless `VITE_PAY_TIER=plus` / `pro`, native entitlement (see `docs/MOBILE_STORE_RELEASE.md`), or LS override. **Capacitor no longer defaults everyone to Plus.**
- **About “Test pay tier” panel:** **Off** in production unless `VITE_PAY_TIER_TEST_PANEL=true` (use only for internal QA builds).
