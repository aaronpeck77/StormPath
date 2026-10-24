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
- `docs/GOLD_STANDARD.md` — **sealed known-good tip** (`gold/current` + dated `gold/…` tags). Do not move gold unless Bill asks to seal/promote.
- `docs/BRAIN.md` — **Forge idea notebook**. **Priority 1 (open on `native/drive`):** native-feel Drive (cam/puck/reliability vs Apple/Google/Waze). Dark Sky glance is **shelved**. See `docs/NATIVE_TRACK.md`.
- Dual track: **`master`** = live App Store / leave it alone. **`native/drive`** = native shell work. Do not merge native into master or ship store from it unless Bill asks.

## Context Bill shared (business / legal — do not ignore)

- Beta testers (work friends) used StormPath on company phones; company allows personal use of phones/laptops — still treat production/store deploys carefully.
- He is moving development off the company laptop onto Forge. Help him run locally; don't expand internal company beta without him asking.

## Rules of engagement

- **Batch pushes (Oct 24, 2026):** Do NOT `git push` until Bill says so. Stack multiple completed changes into local commits; he chooses when to push — saves daily GitHub Actions/minute limits. Still commit locally per completed unit of work so progress is never lost.
- **Netlify is credit-conserved (Oct 24, 2026):** Do NOT trigger Netlify deploys unless there is a real need (function change, `public/` page update, or Bill asks). The `netlify-ignore.sh` gate already skips most builds — respect it; do not work around it.
- Do not deploy to Netlify / TestFlight / App Store unless Bill asks.
- Do not commit `.env` files or Apple certificates/keys.
- Netlify should not rebuild on every GitHub push: `web/scripts/netlify-ignore.sh` skips Drive/UI-only and branch deploys. Only functions / `public/` / Netlify config should spend build minutes (see `docs/NETLIFY_HOSTING.md`).
- Prefer fixing what Bill hits in testing over large refactors.
- If he also has SiteBible open, treat them as separate products/folders.
- Keep thinking about parked Brain items (`docs/BRAIN.md`, `docs/BRAIN_THINKING.md`) while doing other work. Jot connections. Do not build P2/P3 until he asks.

## Standing task: shrink App.tsx incrementally (Oct 24, 2026)

**Any time** a task touches a subsystem that lives inside `web/src/App.tsx` (~3,000 lines of hook orchestration), the agent is expected — *without Bill asking* — to check whether that subsystem's cluster of hooks/state/callbacks can be extracted into its own hook or component (`hooks/use*.ts`, `nav/`, `ui/`). Bill will not remember to ask; do it as part of the fix.

- Extract **one** cluster per task, keep behavior identical, verify `tsc --noEmit` + `npm test` + `npm run build` still pass.
- Already extracted (do not re-extract): settings → `state/settingsStore.ts`, trip plan → `state/tripPlanStore.ts`, route compute → `nav/useComputeRoutes.ts`, status banners → `ui/AppStatusBanners.tsx`, map stage → `ui/AppMapStage.tsx`, bottom/top chrome, about/hazard sheets.
- Prefer extraction opportunities in code being changed anyway — never refactor untouched subsystems just for the split.

## Conventions learned (Devin, Oct 24 2026)

- `master` is the single live track; `native/drive` graduated/merged. TestFlight fires on every push to `master` — put `[skip ci]` in docs-only commits to save macOS runner minutes.
- Keep requests cheap: `dedupeRequest` is wired into Mapbox Directions + OpenWeather; `routeCache` is wired into `useComputeRoutes` (clean plans only). Reuse these utils for new network paths.
- Do not re-add speculative utilities unless a real consumer exists (syncQueue, optimisticUpdates, memoryManager, useOfflineState were removed — safeStorage/useAppOnline already cover it).

## After web runs

Ask Bill what he wants next. Work happens on short-lived feature branches → PR → `master`. TestFlight fires on every push to `master` (or manual workflow_dispatch). App Store only when Bill explicitly asks.
