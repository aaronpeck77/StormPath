# StormPath web — Basic vs Plus

Single source of truth for what ships in each tier. Code gates live in `web/src/billing/payFeatures.ts` (and env for a few toggles).

## Basic (free)

Everything needed for full navigation without a subscription:

| Area | Included |
|------|----------|
| **Map & routing** | Multi-route (A/B/C), Mapbox directions + live traffic, fit/follow, route view / drive / topdown |
| **Search & destination** | Autocomplete, geocode, set destination, trip planning |
| **Driving** | Turn-by-turn banner, bottom toolbar, reroute / off-route flows |
| **Saved** | Saved places (★), save current destination, **saved routes**, **record path (GPS)** and save |
| **Situation** | Fused weather/traffic/hazards along routes, scoring, hazard sheet, Mapbox traffic when configured |
| **Storm advisory (US)** | NWS active-alert polygons + advisory strip when **not** disabled by env (`VITE_STORM_ADVISORY_ENABLED=false`). *Not* pay-gated today — only env. You can move it behind Plus later in `payFeatures` if you want. |

## Plus (paid)

| Feature | Notes |
|---------|--------|
| **Route progress rail** | Right-edge strip while navigating: trip progress, radar/traffic/hazard ticks, segment callouts, route outlook timeline. Gated in `App.tsx` on `isPlus`. |
| **Toll bypass** | Toll warning sheet + preview/compare toll-free alternates before Go or when switching legs. Gated by `hasTollBypass()` in `payFeatures.ts`. Basic still shows **Tolls** on route labels. |
| **Frequent route learning** | Device-local GPS trip detection, clustering, suggestions in ★ drawer, save to favorites. Gated by `hasFrequentRoutesLearning()` → `getPayTier() === "plus"`. |

## Subscription (About sheet)

On the **iOS App Store customer IPA**, Plus is an Apple auto-renewable subscription brokered by RevenueCat (`Subscribe` / `Restore purchases`). Money still goes through Apple. See [`APP_STORE_CHECKLIST.md`](APP_STORE_CHECKLIST.md).

Fallback links (web / missing SDK key):

- **Upgrade to Plus** — only when the effective tier is Basic and IAP is not ready. Set `VITE_UPGRADE_URL` if you need a web checkout or App Store product page.
- **Manage subscription** — defaults to Apple’s page (`https://apps.apple.com/account/subscriptions`). Override with `VITE_MANAGE_SUBSCRIPTION_URL` only if you must.

These are build-time env vars. Rebuild after changing them.

## Version & About

**Version** and **Basic / Plus** appear in the **About** sheet: small **“i”** button on the **map** (bottom-left, above bottom chrome). Sheet: `ui/AboutSheet.tsx`. Version from `web/package.json` via Vite `__APP_VERSION__` in `vite.config.ts`.

## Development vs production

- **`npm run dev` / Capacitor live reload (`import.meta.env.DEV`):** `getPayTier()` returns **Plus** by default so you can verify Plus behavior without env keys.
- **Test Basic in dev:** About → **Test pay tier** → Basic, or `localStorage.setItem("stormpath-pay-tier-override","free")` then reload. Clear override with `removeItem("stormpath-pay-tier-override")` to go back to dev-default Plus.
- **Production build (`vite build`, App Store / Play):** tier is **Basic** unless `VITE_PAY_TIER=plus` / `pro`, native entitlement (see `docs/MOBILE_STORE_RELEASE.md`), or LS override. **Capacitor no longer defaults everyone to Plus.**
- **About “Test pay tier” panel:** **Off** in production unless `VITE_PAY_TIER_TEST_PANEL=true` (use only for internal QA builds).
