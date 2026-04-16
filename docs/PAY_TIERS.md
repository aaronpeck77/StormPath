# StormPath web — Basic vs Plus

Single source of truth for what ships in each tier. Code gates live in `web/src/billing/payFeatures.ts` (and env for a few toggles).

## Basic (free)

Everything needed for full navigation without a subscription:

| Area | Included |
|------|----------|
| **Map & routing** | Multi-route (A/B/C), ORS directions, Mapbox style, fit/follow, route view / drive / topdown |
| **Search & destination** | Autocomplete, geocode, set destination, trip planning |
| **Driving** | Turn-by-turn banner, progress strip (traffic band, hazards, radar ticks), bottom toolbar, reroute / off-route flows |
| **Saved** | Saved places (★), save current destination, **saved routes**, **record path (GPS)** and save |
| **Situation** | Fused weather/traffic/hazards along routes, scoring, hazard sheet, Mapbox traffic when configured |
| **Storm advisory (US)** | NWS active-alert polygons + advisory strip when **not** disabled by env (`VITE_STORM_ADVISORY_ENABLED=false`). *Not* pay-gated today — only env. You can move it behind Plus later in `payFeatures` if you want. |

## Plus (paid)

| Feature | Notes |
|---------|--------|
| **Frequent route learning** | Device-local GPS trip detection, clustering, suggestions in ★ drawer, save to favorites. Gated by `hasFrequentRoutesLearning()` → `getPayTier() === "plus"`. |

## Subscription links (About sheet)

The About → **Subscription** section can show:

- **Upgrade to Plus** — only when the effective tier is Basic. Set `VITE_UPGRADE_URL` to your checkout or App Store app URL (e.g. `https://apps.apple.com/app/id…`).
- **Manage subscription** — set `VITE_MANAGE_SUBSCRIPTION_URL`. Default in `.env.example`: Apple’s subscription management page (`https://apps.apple.com/account/subscriptions`). Use your Stripe Customer Portal or account URL if you bill outside the App Store.

These are build-time env vars (`web/.env` or hosting dashboard). Rebuild after changing them.

## Version & About

**Version** and **Basic / Plus** appear in the **About** sheet: small **“i”** button on the **map** (bottom-left, above bottom chrome). Sheet: `ui/AboutSheet.tsx`. Version from `web/package.json` via Vite `__APP_VERSION__` in `vite.config.ts`.

## Development vs production

- **`npm run dev`:** `getPayTier()` returns **Plus** by default so you can verify Plus behavior without env keys.
- **Test Basic in dev:** in the browser console: `localStorage.setItem("stormpath-pay-tier-override","free")` then reload. Clear with `removeItem("stormpath-pay-tier-override")` to go back to dev-default Plus.
- **Production build:** tier is **Basic** unless `VITE_PAY_TIER=plus` / `pro` or you wire real billing into `getPayTier()`.
