# StormPath — Forge handoff (for Cursor Agent)

You are on the user's **personal PC (Forge)**. StormPath was developed on a work laptop and should live under `C:\My Apps\StormPath - v3` (there may also be `StormPath  - Copy_Stable`). Local Cursor chat history did **not** sync. This file is the continuity brief.

## Your job right now

Help Bill get StormPath running on Forge (web first; mobile/iOS only if he asks). Prefer local/dev and existing docs. Do **not** push production Netlify/App Store changes unless he explicitly asks.

## What StormPath is

Driving-first multi-route navigation / "route command center" with Mapbox map, traffic ETAs, and fused situation layer (weather/radar/hazards). Web (Vite + React) for fast UI; mobile (Expo + React Native + Mapbox) for phone / future CarPlay. Closed beta / TestFlight docs exist under `docs/`.

## Stack & paths

- Preferred path: `C:\My Apps\StormPath - v3`
- `web/` — Vite + React + Mapbox (primary day-to-day)
- `mobile/` — Expo / RN (dev builds, not Expo Go)
- Apple signing keys often live in parent folder `C:\My Apps\` (`AuthKey_*.p8`, `certificate.p12`, etc.) — keep them; never commit
- Human onboarding already exists: `START_HERE.md` and `README.md` — follow those

## First-run checklist (do these)

1. Open folder `StormPath - v3` in Cursor (not only the stable copy unless Bill says so).
2. Confirm `web/.env` exists with at least `VITE_MAPBOX_TOKEN=...`. If missing, copy from `web/.env.example` and ask Bill for keys — do not invent tokens.
3. Ensure Node.js LTS is installed.
4. Run web:
   ```bash
   cd web
   npm install
   npm run dev
   ```
   Or point Bill at `web/RUN_APP.bat` double-click if present.
5. Local URL is usually `http://localhost:5173`. Phone on same Wi‑Fi uses the Network URL from the terminal / bat file.
6. For mobile later: see `mobile/README.md` and `mobile/.env.example` (`EXPO_PUBLIC_MAPBOX_TOKEN`), plus Mapbox download token in `mobile/app.json` for prebuild.

## Docs to prefer

- `START_HERE.md` — non-coder install steps
- `docs/NETLIFY_HOSTING.md`, `docs/BETA_READINESS.md`, `docs/TESTER_NOTES.md`
- `docs/GITHUB_TESTFLIGHT_ONLY.md` — TestFlight without Mac
- `web/docs/IOS_APP_STORE.md` — Capacitor / App Store path under `web/ios/`

## Context Bill shared (business / legal — do not ignore)

- Beta testers (work friends) used StormPath on company phones; company allows personal use of phones/laptops — still treat production/store deploys carefully.
- He is moving development off the company laptop onto Forge. Help him run locally; don't expand internal company beta without him asking.

## Rules of engagement

- Do not deploy to Netlify / TestFlight / App Store unless Bill asks.
- Do not commit `.env` files or Apple certificates/keys.
- Prefer fixing what Bill hits in testing over large refactors.
- If he also has SiteBible open, treat them as separate products/folders.

## After web runs

Ask Bill what he wants next: map/route bugs, beta tester issues, mobile build, or Netlify. Wait for his direction.
