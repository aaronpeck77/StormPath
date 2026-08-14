# Store readiness plan

Living checklist for moving StormPath from TestFlight beta → public App Store launch.

**Launch go / no-go (2026-08-14):** use [`APP_STORE_CHECKLIST.md`](APP_STORE_CHECKLIST.md). Several Phase 1 boxes below are stale (armv7 already `arm64`; real AdMob IDs are in `Info.plist` / `.env.production`). Bundle id is **`com.aaronpeck.stormpath`**, not `com.stormpath.app`.

Source of truth across chat sessions. Tick boxes as items land. Add notes inline as decisions evolve.

> **Posture:** TestFlight has 5 beta testers (installed today, 2026‑05‑26). Plus tier on testers comes from `.env.testflight` `VITE_PAY_TIER=plus`. Iteration happens in dev (`npm run dev`); TestFlight only gets a new build after each phase is verified locally.

> **📌 2026-07-24 note (from a SiteBible session):** Was setting up Apple Business, Stripe, and RevenueCat accounts for SiteBible's future multi-seat billing when it came up that **StormPath's Phase 7 is blocked on the exact same RevenueCat account creation step below.** The RevenueCat account being created that night is reusable here — RevenueCat supports multiple "projects" (one per app) under a single account/login, so there's no need for a second signup. Next time you're in a StormPath session: check whether that RevenueCat account already exists, sign in, and create a StormPath project there (bundle id `com.stormpath.app` or whatever `PRODUCT_BUNDLE_IDENTIFIER` currently is) — that's step 2 of the "Remaining" list under Phase 7 below. Steps 1, 3, 4 still need doing regardless (App Store Connect subscription products, pasting the API key into `.env.testflight`/`.env.production`, sandbox testing on a real iPhone).

---

## Phase 1 · App Store submission unblockers

Cheap, mostly metadata, do first.

- [ ] **`PrivacyInfo.xcprivacy`** — Apple‑required Privacy Manifest. File at `web/ios/App/App/PrivacyInfo.xcprivacy`. Declares: required‑reason APIs (UserDefaults), data types collected (precise location, crash data, diagnostic data, performance data, search history), tracking off, no tracking domains. **Update when AdMob goes live** to flip `NSPrivacyTracking` true and add `NSPrivacyTrackingDomains` (Google ad domains) + `Device ID` collection with `tracking: true`.
- [ ] **Drop `armv7`** from `UIRequiredDeviceCapabilities` in `Info.plist`. iOS 26 SDK is arm64 only; armv7 is meaningless and looks dated. Replace with `arm64` or remove the array entirely (Capacitor‑era apps don't need it).
- [ ] **Real AdMob app ID** — current `Info.plist` line 60–61 has Google's test ID `ca-app-pub-3940256099942544~1458002511`. Register the real StormPath app at admob.google.com → paste the `ca-app-pub-XXXXX~XXXXX` value into `GADApplicationIdentifier` in `web/ios/App/App/Info.plist`. Also paste the matching banner unit ID (`ca-app-pub-XXXXX/XXXXX`) into `web/.env.testflight` and `web/.env.production` as `VITE_ADMOB_BANNER_UNIT_ID=...`; until then the test banner from `ADMOB_TEST_BANNER_UNIT_ID` keeps showing and AdMob may suspend the account if the test ID ships at scale.
- [x] **App Tracking Transparency call site** — `NSUserTrackingUsageDescription` is in plist already. `ensureTrackingAuthorization()` in `web/src/ads/adMobClient.ts` runs **before** `AdMob.initialize(...)` (Apple-required ordering — they verify by inspecting first-launch network traffic) and resolves the user's choice exactly once via `AdMob.requestTrackingAuthorization()` when status is `notDetermined`. Concurrent callers share an in-flight promise so the modal can never be presented twice. Result is cached in module state and read by `showBasicBanner`: `npa: false` (personalized) only when `authorized`; everything else (`denied` / `restricted` / `notDetermined` / `unsupported` / errors) keeps `npa: true`. Plus users never reach this code (banner gated on Basic tier in `useBasicAdMobBanner`); Basic users hit the modal exactly once on the first foreground that triggers a banner show.
- [ ] **Verify export compliance** — `ITSAppUsesNonExemptEncryption=false` in plist + CI export options. Already correct; just keep an eye on it if any new SDK is added.

**Done when:** App Store reviewer can submit a build with no privacy/tracking blockers and no Google test IDs.

---

## Phase 2 · Data layer — `localStorage` → Capacitor Preferences

Foundation for safe iteration. Touched ~18 files.

- [x] Add `@capacitor/preferences` dependency. (`@capacitor/preferences@8.0.1` — registered in iOS Package.swift via `cap sync`.)
- [x] Wrapper at `web/src/storage/safeStorage.ts` — sync API backed by an in-memory `Map<string,string>` cache; native writes route through `Preferences.set/remove` (NSUserDefaults / SharedPreferences); web writes route through `window.localStorage`. Same `get`/`set`/`remove`/`getJson`/`setJson` shape so React `useState(() => readSetting())` initializers stay sync.
- [x] **Boot hydration** — `hydrateSafeStorage()` runs in `web/src/main.tsx` before `createRoot().render()`. On native it calls `Preferences.keys()` + `.get()` for every key; on web it walks `window.localStorage`. The first time it runs on a native build, any keys present in WKWebView's localStorage but not yet in Preferences are copied over (one-shot migration — existing testers keep their saved places, recent searches, settings, NWS session, storm bar expanded state, pay-tier override, native Plus entitlement, layer prefs, activity samples, frequent route clusters, dev location pin).
- [x] All `localStorage.*` callers converted: `App.tsx`, `layerStartupPrefs.ts`, `DriveMap.tsx`, `AboutSheet.tsx`, `useUserLocation.ts`, `useFrequentRouteLearning.ts`, `useSavedPlaces.ts`, `nav/savedPlaces.ts`, `nav/savedRoutes.ts`, `recentSearches.ts`, `preferredAreaRoutes.ts`, `frequentRoutes/clusters.ts`, `frequentRoutes/activitySamples.ts`, `services/tomorrowIoClient.ts`, `billing/storeEntitlement.ts`, `billing/payFeatures.ts`, `utils/dataSaver.ts`, `ui/coachmarks/firstLaunchSteps.ts`. Only `safeStorage.ts` itself touches `window.localStorage` (the web backing store).
- [ ] Verify settings survive a fresh install + iCloud restore on a test device.

**Risk addressed:** the boot-time migration in `hydrateSafeStorage` runs before React mounts, so existing TestFlight testers keep their saved data on the upgrade.

**Done when:** every `localStorage` reference (other than the wrapper itself) is gone, saved data round-trips through Preferences, and a fresh-install + iCloud-restore cycle is verified on a real device.

---

## Phase 3 · Test seatbelt

Cheap insurance before the bigger refactors.

- [x] Add Vitest + minimal config (`vitest@^2`, `node` test environment, sync sources via `vitest/config` so the existing Vite config and dev/build pipelines are unchanged).
- [x] `npm test` (vitest run) and `npm run test:watch` scripts in `web/package.json`.
- [x] Tests for `web/src/nav/detectRouteTolls.ts` — toll-class flagging, named/unnamed booth handling, dedupe + 8-label cap, blank-label edge cases. (`src/nav/__tests__/detectRouteTolls.test.ts`, 8 tests)
- [x] Tests for `web/src/nav/routeImpacts.ts` — `compareRouteImpactPriority` ordering (severity → action → numeric), `pickRerouteImpactAhead` window/confidence/null-distance gating, `routeImpactToRouteAlert` corridorKind / zoom / promptRerouteAhead mapping, `impactSeverityToNumeric` monotonicity. (`src/nav/__tests__/routeImpacts.test.ts`, 15 tests)
- [x] Tests for `web/src/nav/tollRouteCompare.ts` — display plan composes A=current, B=toll-free with stable ids, label fallbacks, no-mutation guarantee. (`src/nav/__tests__/tollRouteCompare.test.ts`, 4 tests)
- [x] Tests for `web/src/nav/surgicalBypassWindow.ts` — `plenty` / `tight` / `nextExit` framing thresholds, lead-time floor (gap < 30 s of speed), short-span null branch, endpoint clamping, conservative speed fallback. Plus `earlyApproachMaxMetersForSpeed` floor / cap. (`src/nav/__tests__/surgicalBypassWindow.test.ts`, 13 tests)
- [x] Tests for `web/src/scoring/scoreRoutes.ts` — `pickSuggestedActive` stress + ETA tiebreak, `scoreTrip` ETA selection (live vs static), preset-specific `notable` rules, fallback fuseSummary. (`src/scoring/__tests__/scoreRoutes.test.ts`, 10 tests)
- [x] CI: `npm test` runs after the TypeScript check in `.github/workflows/ios-build.yml` (failures block the IPA build).
- [x] Latent type-safety cleanup: replaced `ReturnType<typeof setTimeout>` annotations with `number` so the browser-side `setTimeout` return type is unambiguous after the new `@types/node` transitive dep landed (App.tsx ×2, DriveMap.tsx ×6).

**Outcome:** 50 unit tests, run in ~1.2 s locally and in CI. Fast feedback for the next refactors (`App.tsx` slice, React 19 / Vite 7 upgrade, IAP wiring) without paying for jsdom or a renderer until React component tests land.
- [ ] CI step: `npm test` before TS check on push.

**Done when:** ~15–25 deterministic unit tests cover routing math; CI fails if they break.

---

## Phase 4 · Slice `App.tsx`

`App.tsx` is 232 KB / ~5,600 lines. Single biggest maintenance risk. Strategy: carve out one store at a time, smallest-and-cleanest first, **without changing behavior**. Each slice ships independently so regressions stay localized.

### Phase 4a · settingsStore (done)

- [x] Added `zustand@^5` (~1 KB, no provider).
- [x] `web/src/state/settingsStore.ts` owns the 10 persisted user-settings flags: `stormEnabled`, `trafficEnabled`, `radarEnabled`, `weatherHintsEnabled`, `autoRerouteEnabled`, `dataSaverEnabled`, `dataSaverHintDismissed`, `voiceGuidanceEnabled`, `gpsHighRefreshEnabled`, `landscapeSideHand`. Each setter writes through to `safeStorage` / `layerStartupPrefs` so persistence and React state can't drift.
- [x] Initial values are read synchronously from `safeStorage` (already hydrated from Preferences before React mounts in `main.tsx`), so first-paint behavior is identical to the prior `useState(() => readSetting())`.
- [x] App.tsx wired via per-field selectors (`useSettingsStore((s) => s.stormEnabled)`). Local variable names (`settingStormEnabled`, `setSettingStormEnabled`, …) preserved so the ~50 read sites and the AboutSheet wiring stayed unchanged.
- [x] Dropped 8 persistence-only `useEffect` blocks. The remaining 4 effects keep their *side-effect* code (clear storm map state, set `trafficOverlay = undefined`, hide radar layer, clear weather overlay) but no longer also call `safeStorage.set(...)`.
- [x] Collapsed the dual-write data-saver-hint dismiss site (was: `dismissDataSaverHint(); setDataSaverHintDismissed(true);` — now: `dismissDataSaverHintAction();`) and the dual-write in the AboutSheet `onSettings` handler (was calling both `setSettingX(v)` and `writeXSettingOn(v)`).
- [x] App.tsx: 5697 → **5586 lines** (-111). 8 unused imports dropped (`readDataSaverSetting`, `readDataSaverHintDismissed`, `dismissDataSaverHint`, `LS_DATA_SAVER`, `readStormSettingOn`, `readTrafficSettingOn`, `readRadarSettingOn`, `writeStormSettingOn`, `writeTrafficSettingOn`, `writeRadarSettingOn`).
- [x] Bundle cost: index chunk +1.3 KB raw / +0.6 KB gzipped (Zustand). 50 tests still passing; tsc + build clean.

### Phase 4b · tripPlanStore (done)

- [x] `web/src/state/tripPlanStore.ts` owns the 7 trip-planning fields previously stored as `useState` in App.tsx: `plan`, `routeSlotOrder`, `previewLegIndex`, `destLngLat`, `destinationLabel`, `viewMode`, `navigationStarted`.
- [x] Each setter accepts `T | ((prev: T) => T)` (matches React's `SetStateAction<T>` shape) so the 12 functional-updater call sites in App.tsx (e.g. `setPlan((prev) => mergePlanPreservingPrimary(prev, primaryId, fresh))`, `setRouteSlotOrder((prev) => slotOrderAfterSelect(prev, id))`, `setPreviewLegIndex((i) => Math.min(i, n - 1))`) work unchanged.
- [x] App.tsx wired via per-field selectors. Local names (`plan`, `setPlan`, `viewMode`, `setViewMode`, …) preserved → all ~120 read sites and ~30 setter call sites in this file are untouched. `useRef`-based mirrors (`navigationStartedRef`, `destLngLatRef`) keep working because they read from the same local names.
- [x] No persistence to migrate — trip plans are session-scoped (the prior `useState` initializers were `EMPTY_TRIP` / `null` / `""` / `"route"` / `false` and the new store mirrors those defaults exactly).
- [x] `npx tsc --noEmit` clean, all 50 unit tests pass, `npm run build` clean. No bundle delta beyond Phase 4a (Zustand was already in).

### Phase 4c · routeCompareStore (done)

- [x] `web/src/state/routeCompareStore.ts` owns the three pieces of state that drive the on-map A/B(/C) compare flow used by both traffic-bypass *and* toll preview: `trafficBypassCompare`, `tollRoutePrompt`, `tollCompareContext`. The `TrafficBypassCompareState` and `TollRoutePrompt` types moved next to the store so panel and store can never drift.
- [x] App.tsx wired via per-field selectors. Setter signatures preserved (`Updater<T>` pattern from 4b) so the ~30 reads / setters in this file are unchanged.
- [x] `tollCompareContextRef = useRef(...)` retired in favor of imperative store helpers `getTollCompareContext()` / `setTollCompareContext()`. Toll preview lifecycle keeps fire-and-forget mutability without triggering compare-panel re-renders (no component subscribes to that field via selector — only the imperative cancel/confirm handlers read it).
- [x] `dismissOverlaysForRouteCompare` and `activateRouteCompare` stay in App.tsx for now. They reach into ~13 cross-feature setters (sheets, drawers, search, storm bar, demo flags) that still live as `useState` here. Phase 4d (weatherStore) and Phase 4e (component splits) will trim that surface; once shrunk, a `useRouteCompareActions` hook can move next to `routeCompareStore.ts` without becoming a 14-prop config bag.
- [x] `npx tsc --noEmit` clean, 50 unit tests pass, `npm run build` clean. Bundle delta: index +0.5 kB raw / +0.13 kB gzipped. App.tsx: 5283 → 5271 lines (-12).

### Phase 4d · weatherStore (done)

- [x] `web/src/state/weatherStore.ts` owns the 6 storm/advisory fields previously scattered across `useState` in App.tsx: `stormCorridorAlerts`, `stormOverlapping`, `stormMapGeoJson`, `stormLoading`, `stormError`, `stormBarExpanded`.
- [x] `setStormBarExpanded` writes through to `safeStorage` inside the store action so persistence and React state can't drift. The dual-write at `onStormBarExpandedChange` (was `setStormBarExpanded(...); safeStorage.set(...)`) collapsed to a single setter call, and the redundant `safeStorage.set(...)` in the storm-OFF reset effect dropped (the store handles it).
- [x] **Transient collapse preserved.** `dismissOverlaysForRouteCompare` used to call `setStormBarExpanded(false)` *without* persisting (it's a "hide the bar so compare can use the screen" UI affordance, not a user preference). Naively wiring the new store would have started persisting that collapse, leaving the bar hidden on next cold launch. Added a dedicated `collapseStormBarTransient()` action that updates in-memory state only — exact behavior preserved.
- [x] Legacy `stormpath-storm-drawer-expanded` key migration moved out of App.tsx into `readStormBarExpanded()` inside the store, so existing TestFlight testers' setting still carries forward on the first launch of this build.
- [x] App.tsx wired via per-field selectors; the ~40 read/setter sites in this file are unchanged.
- [x] `npx tsc --noEmit` clean, 50 tests pass, `npm run build` clean. Bundle delta: index +0.96 kB raw / +0.25 kB gzipped (new store module). App.tsx: 5271 → 5277 lines (+6 — expanding the 6 `useState` initializers into selector+setter pairs net-added a few lines; the offsetting line drops happen when 4e extracts components that subscribe to the store directly).
- [x] **`dismissOverlaysForRouteCompare` dep count: 13 → 12.** `setStormBarExpanded` is now a store action — same goal as the plan called out in Phase 4c.

### Phase 4e · component splits (in progress)

Bigger than 4a–4d combined: each prior phase relocated state declarations; 4e moves actual code (JSX render blocks, hooks) out of App.tsx. Sliced into sub-phases so each can ship independently.

#### Phase 4e1 · `<RouteCompareBottomPanel />` (done)

- [x] `web/src/ui/RouteCompareBottomPanel.tsx` is an App-level wrapper around `TrafficBypassComparePanel` that subscribes to `routeCompareStore` + `tripPlanStore` directly. App.tsx now forwards 3 handlers instead of 14 fields off `trafficBypassCompare`, and the `{trafficBypassCompare && (...)}` gate lives inside the wrapper. The underlying `TrafficBypassComparePanel` primitive stays generic (still no store coupling) so it can be reused in tests / future contexts.
- [x] Behavior preserved: toll-compare mode still substitutes `"With tolls"` / `"Toll-free"` labels and forces `navigationStarted=false` + the `"Use this route"` confirm label; traffic mode still pulls live labels from `plan.routes`.

#### Phase 4e2 · `<TollFlowSheets />` (done)

- [x] `web/src/ui/TollFlowSheets.tsx` wraps `TollRouteSheet` and subscribes to `routeCompareStore` for `tollRoutePrompt`. App.tsx no longer derefs `tollRoutePrompt?.X` at the render site — it just forwards the 4 handler / busy props. Small but clean; same pattern as 4e1.

#### Phase 4e3 · `applySettings` bulk action (done)

- [x] Settings store gained an `AppSettings` type (the 9-field shape passed to / from About) and an `applySettings(next)` action that persists each field through its existing helper (`writeXSettingOn`, `safeStorage.set`) and pushes a single batched store update. About sheet's `onSettings` callback collapsed from 11 lines (9 individual setters + redundant radar-OFF inline) to 1 line (`applySettings(next)`).
- [x] Dropped the inline radar-OFF block (was: `setShowRadar(false); writeRadarOverlayOn(false)` inside `onSettings`). The existing `useEffect([settingRadarEnabled])` at the top of App.tsx catches the same case one tick later — functionally identical.
- [x] Dropped 9 individual `setSettingX` selectors from App.tsx (`setSettingStormEnabled`, `setSettingTrafficEnabled`, `setSettingRadarEnabled`, `setSettingWeatherHintsEnabled`, `setSettingDataSaverEnabled`, `setSettingAutoRerouteEnabled`, `setSettingVoiceGuidanceEnabled`, `setSettingGpsHighRefreshEnabled`, `setSettingLandscapeSideHand`) — they had a single consumer each (the About sheet) and the bulk action covers all of them. Per-toggle handlers elsewhere (toolbar Radar overlay) operate on the App-owned `showRadar` map-overlay state, not on the persistent setting, so they didn't need the individual setters either.

**4e progress so far:** App.tsx 5277 → **5234 lines** (-43 — the biggest drop in any Phase 4 sub-phase). 50 tests passing, `tsc --noEmit` clean, build clean. Bundle index chunk: +0.4 kB raw / +0.13 kB gzipped (2 new component wrappers + `applySettings`; offset by App.tsx shrinkage).

#### Phase 4e4 · hazard sheet hoist + `useTollPreview` (done)

- [x] **Route hazard sheet JSX** — hoisted the `(() => { … })()` IIFE wrapping the `<RouteHazardSheet>` block into a top-level `useMemo` (`hazardSheetAlternateAvailable`) and a top-level `useCallback` (`handleHazardSheetTryAlternate`). The JSX collapsed from a 47-line IIFE-with-inline-lambda to a clean 9-line `<RouteHazardSheet … />` call. Logic is identical; the render path is just declarative now (no inline function allocations per render).
- [x] **`useTollPreview` hook** — `web/src/nav/useTollPreview.ts` owns the 92-line toll-free reroute kickoff that was previously a `useCallback` inside App.tsx. The hook subscribes to `routeCompareStore` (`tollRoutePrompt`) + `tripPlanStore` (`plan`, `destLngLat`, `destinationLabel`, `routeSlotOrder`, `previewLegIndex`, `viewMode`, `setPlan`, `setRouteSlotOrder`, `setPreviewLegIndex`) directly. App.tsx forwards 9 deps: `userLngLat`, `mapboxToken`, `isPlus`, `stormAlertsForRouting`, `stormEnabled`, the `pendingGoAfterTollRef` ref, two App-owned setters (`setTollAvoidBusy`, `setTollAvoidFailureNote`), and `activateRouteCompare`.
- [x] Result: App.tsx **5253 → 5177 lines** (-76 from this sub-phase alone). 50 tests still passing. Toll preview flow behavior identical (same Mapbox call shape, same Plus capping, same compare panel activation).

**Cumulative Phase 4 progress (4a → 4e4):** App.tsx **5697 → 5177** (-520 lines, ~9.1%). State surface that used to live as `useState` in App is now distributed across 4 Zustand stores (`settingsStore`, `tripPlanStore`, `routeCompareStore`, `weatherStore`). Two component wrappers (`RouteCompareBottomPanel`, `TollFlowSheets`) and one hook (`useTollPreview`) own subscriptions directly.

#### Phase 4e5 · UI store + route-compare actions + computeRoutes hook ✅

- [x] **`useUiStore` (ephemeral overlay state)** — `web/src/state/uiStore.ts` owns 11 transient overlay fields that used to be scattered `useState` declarations across App.tsx (`routeHazardSheet`, `savedDrawerOpen`, `aboutOpen`, `corridorForecastOpen`, `pendingSave`, `searchExpanded`, `searchEditing`, `mapFocus`, `progressCalloutsOpen`, `demoApproachBannerOn`, `demoCloseHazardOn`). Each setter accepts an `Updater<T>` for `useState`-shaped functional updates. A single `dismissAllOverlays()` action collapses what used to be 11 sequential setter calls inside `dismissOverlaysForRouteCompare` into one batched store update. The `viewModeBeforeTrafficBypass` ref also moved here as a module-local imperative variable + `getViewModeBeforeTrafficBypass()` / `setViewModeBeforeTrafficBypass()` thin helpers (mirrors the `tollCompareContext` pattern from Phase 4c). The `PendingSave` discriminated-union type moved into the store and is exported from there. Type-only imports `RouteTurnStep`, `MapFocusRequest`, `FrequentRouteCluster` are no longer needed in App.tsx.
- [x] **`useRouteCompareActions` hook** — `web/src/state/useRouteCompareActions.ts` owns the two helpers that orchestrated route-compare entry: `dismissOverlaysForRouteCompare` (closes every overlay across the 3 relevant stores so the on-map A/B/C compare has a clear map) and `activateRouteCompare` (snapshots prior view mode, opens the panel, switches to top-down, bumps the fit trigger). The hook subscribes to all four state stores directly (uiStore, routeCompareStore, tripPlanStore, weatherStore); the only App-owned dep threaded through is `setFitTrigger`.
- [x] **`useComputeRoutes` hook** — `web/src/nav/useComputeRoutes.ts` owns the 106-line main route-build entry point (largest single callback in App.tsx). Same external API as the prior App-owned `computeRoutes` — `(end, label, opts?) → Promise<ComputeRoutesResult>` — so the dozens of call sites are unchanged. Subscribes to routeCompareStore (toll prompt clear), tripPlanStore (plan/order/preview/dest/view-mode setters), and uiStore (search collapse) directly. App.tsx forwards 16 deps via a config bag: refs (`routeGraphEpochRef`, `routeMainFetchAbortRef`, `tollAcceptedRouteIdsRef`, `pendingGoAfterTollRef`, `preferredAreaRouteMapRef`), env (`mapboxToken`), live data (`userLngLat`, `stormAlertsForRouting`), pay-tier flags (`isPlus`, `payFrequentRoutes`, `stormEnabled`), App-owned setters (`setRouting`, `setRouteError`, `setTapHint`, `setTollAvoidFailureNote`, `setFitTrigger`), and the App-owned `resetNavigationPlanning` reducer. App.tsx also no longer imports `computeRoutesFailed`, `computeRoutesSucceeded`, `tollAvoidFailureExplanation`, `tollFreeReplanStillHasTolls`, `ComputeRoutesResult` — they all live next to the hook.
- [x] Result: App.tsx **5177 → 5095 lines** (-82 from this sub-phase alone). 50 tests still passing; build clean; bundle index chunk +0.49 kB gzipped (the new hooks and store add a small amount of glue). All flows behaviorally identical (same Mapbox call shape, same epoch/abort dance, same Plus capping, same compare-panel dismiss order).

**Cumulative Phase 4 progress (4a → 4e5):** App.tsx **5697 → 5095** (-602 lines, ~10.6%). State surface is now distributed across 5 Zustand stores (`settingsStore`, `tripPlanStore`, `routeCompareStore`, `weatherStore`, `uiStore`) plus 3 colocated hooks (`useTollPreview`, `useRouteCompareActions`, `useComputeRoutes`) and 2 component wrappers (`RouteCompareBottomPanel`, `TollFlowSheets`).

**Target:** drop `App.tsx` under 80 KB / ~2,000 lines. Phases 4a–4e5 brought it from 5697 → 5095 (-602, ~10.6%); future 4f sub-slices (drive-mode controls, learned-route plumbing, and demo-bypass panel) could carry another ~700 lines if pursued, but the current state is no longer a "state god-object" — it's a layout + composition file with localized callbacks. Diminishing returns from here.

**Risk:** any refactor of this size introduces subtle regressions. Phase 3 tests + the `.env.local` Free tier check are the safety net. Ship as standalone "internal cleanup" builds to TestFlight, one slice at a time, with a heads-up to the 5 testers.

**Done when:** `App.tsx` is a layout + composition file, not a state god-object.

---

## Phase 5 · Modern toolchain ✅

Low risk after Phase 4 is solid.

By 2026 the targets in the original plan were already overtaken — TS 6.0, Vite 8, Vitest 4, plugin-react 6, mapbox-gl 3.24, Capacitor 8.3.4, Sentry 10.54, React 19.2.6, react-compiler 1.0.0 are the current stable versions. All landed; details below.

#### Phase 5a · safe minors / patches ✅

- [x] **mapbox-gl 3.22.0 → 3.24.0** — patch release with internal crash fixes (some of which were the Sentry exceptions we'd been ignoring).
- [x] **`@capacitor/*` 8.3.1 → 8.3.4** — `core`, `cli`, `ios`, `geolocation`, `preferences`. Patch-level bug fixes only.
- [x] **`@capacitor-community/admob` 8.0.0** — already current.
- [x] **`@capacitor-community/keep-awake` 8.0.1** — already current.
- [x] **`@sentry/react` 10.53.1 → 10.54.0** — minor with no breaking changes.

#### Phase 5b · TypeScript 6.0 ✅

- [x] **TypeScript 5.6.2 → 6.0.3** — major bump (skipped 5.7, 5.8, 5.9 in one swing). Zero compile errors out of the box; the codebase had been on strict-enough patterns that nothing surfaced. `tsc --noEmit` runs in ~7s on the 5,095-line `App.tsx`.

#### Phase 5c · Vite 8 + Vitest 4 + plugin-react 6 ✅

- [x] **Vite 5.4 → 8.0** — major bump that switched the bundler from Rollup to **Rolldown** (Rust-based) and the CSS minifier from esbuild to **Lightning CSS**. Build time dropped from ~14s to **~730ms** (≈19× faster). Two breaking changes hit:
  - Rolldown only accepts function-form `manualChunks`. Updated `vite.config.ts` accordingly: `manualChunks: (id) => id.includes("node_modules/mapbox-gl/") ? "mapbox-gl" : undefined`.
  - Lightning CSS treats the long-standing "Unexpected `}`" warning (a stray `}` at the top of `App.css`, present since the early days) as a hard error. Fixed by removing the orphan brace and duplicated section header on lines 1-2.
- [x] **Vitest 2.1.9 → 4.1.7** — major bump. All 50 tests pass with no config changes. Test runtime ~520ms (was ~2s).
- [x] **`@vitejs/plugin-react` 4.3.3 → 6.0.2** — major bump, paired with Vite 8.
- [x] Bundle deltas after 5a–5c: index chunk 538 → 524 kB raw (-14 kB) / 172 → 165 kB gzipped (-7 kB). CSS 199 → 193 kB (-6 kB) thanks to Lightning CSS. Mapbox chunk roughly unchanged. Net: smaller bundle, ~19× faster build.

#### Phase 5d · React 19 + React Compiler 1.0 ✅

- [x] **React 18.3.1 → 19.2.6** + types 19.2.15 / 19.2.3. Zero compile errors, all tests pass, dev server (Vite HMR) boots clean in ~280ms. Index chunk grew 524 → 574 kB raw / 165 → 179 kB gzipped (the React 19 runtime is slightly heavier than 18 — expected, accepted).
- [x] **`babel-plugin-react-compiler@1.0.0`** — wired into `@vitejs/plugin-react`'s Babel plugin chain in `vite.config.ts`. Compiler runs on every component during build and during dev HMR; no source changes required. Verified emission by grepping the build output: 5 `useMemoCache` calls, 1 `react.memo_cache_sentinel`, 3 `c(N)` cache slot accesses. Conservative coverage by design — most of `App.tsx` is already hand-memoized so the compiler bails on those (which is the safe fallback). Where it does run, the auto-memoization is belt-and-suspenders rather than load-bearing.
- [x] **Solo TestFlight test plan:** the user is the lone tester for several days post-push. Watch for: (1) doubled effect runs in dev StrictMode (safe — only matters for cleanup logic with side effects, and we audited those during Phase 4); (2) any "stale closure" symptoms in the toll prompt / hazard sheet / route compare flows (these are the most ref-heavy paths the compiler touches); (3) any console warnings beginning with `[React Compiler]` during dev — those are non-fatal advisories worth investigating later.

**Result:** clean build on latest toolchain (Node 22 / TS 6 / Vite 8 + Rolldown / Vitest 4 / React 19.2.6 + Compiler 1.0). Build time ~730ms, test time ~520ms, dev HMR boot ~280ms. All 50 tests pass, types clean, dev server serves transformed modules without errors.

**Done.**

---

## Phase 6 · Data fetching — TanStack Query

- [ ] Add `@tanstack/react-query`.
- [ ] Migrate weather hooks: `useTomorrowMinutePrecip`, `useTomorrowRouteForecast`, `useLocalHourlyForecast`, `useCorridorRouteForecasts`. Each becomes a single `useQuery` with proper key, stale time, retry.
- [ ] Migrate NWS provider calls in `nwsUsProvider.ts`.
- [ ] Pause queries when app is backgrounded (`useAppForeground` already exists — wire it into Query's focus manager).
- [ ] Reuse Query cache across components — eliminate duplicate fetches when the storm bar opens.

**Done when:** ad‑hoc `useEffect`+`fetch` patterns are gone for weather data. Network panel shows fewer redundant requests.

---

## Phase 7 · Real IAP — code wiring complete (dashboard work pending)

- [x] **Decided: RevenueCat.** Single dashboard for App Store + future Play Store, free up to $2.5K MTR (1% above), built-in receipt validation / restore / refund detection / family sharing. The 1% is trivial vs the operational reduction; switching later would be painful (dual-running + entitlement sync) so the choice was made up front.
- [x] **`@revenuecat/purchases-capacitor@13.1.3` installed** and registered as the 5th iOS Capacitor plugin (verified via `npx cap sync ios` — appears in `ios/App/CapApp-SPM/Package.swift`).
- [x] **Wrapper module** at `web/src/billing/revenueCat.ts` (~250 lines):
  - `STORMPATH_PLUS_ENTITLEMENT_ID = "plus"` — must match the entitlement name configured in the RevenueCat dashboard exactly. Hardcoded constant rather than env var so a typo can't silently disable Plus for everyone.
  - `initRevenueCat({ iosApiKey })` — idempotent, async, no-op on web / when key is empty. Calls `Purchases.configure`, sets log level (`DEBUG` in dev, `INFO` in prod), attaches a `customerInfoUpdateListener`, and pulls initial state (covers fresh install + iCloud restore + background purchase cases).
  - `purchasePackage(pkg)` / `restorePlusEntitlement()` — return a small union (`ok` / `cancelled` / `unsupported` / `error`) so the UI can decide between "show success", "swallow silently" (cancellation), and "show error message". Cancellation is detected via `PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR` rather than the deprecated `userCancelled` boolean.
  - `friendlyPurchaseErrorMessage()` — translates RevenueCat's verbose error codes into the eight short messages we'd actually want on screen ("Network unavailable", "Purchases are restricted on this device. Check Screen Time / Family Sharing settings.", "You already own this subscription. Try Restore Purchases instead.", etc.).
  - **Bridge to existing entitlement infra:** `applyCustomerInfo(info)` mirrors `info.entitlements.active.plus !== undefined` into `safeStorage` via `setNativePlusEntitlementActive()` and dispatches a `stormpath:native-pay-tier-changed` window event so App.tsx can re-read `getPayTier()` without a prop chain back into the SDK. Same `reprobePayTier()` mechanism the dev "Test pay tier" panel uses.
- [x] **React hook** at `web/src/billing/useRevenueCat.ts` — owns ready/busy/message state and `purchase` / `restore` callables for the AboutSheet Subscription panel.
- [x] **AboutSheet UI updates** — when `iap.ready` is true (native + API key set + `configure()` resolved):
  - The "Upgrade to Plus" link is replaced by a native Subscribe button labeled with the offering's monthly price (`Subscribe — $4.99 / mo`, locale-formatted by the App Store).
  - A **Restore purchases** button appears (App Store Review Guideline 3.1.1 requires it for any IAP app — always shown when IAP is wired, including for users who already have Plus active).
  - Success / error banner below the action row (green for success, muted for errors / "no purchases found"; cleared on sheet close).
  - When IAP is *not* ready (web / missing key / pre-configure), the panel falls back to the existing `env.upgradeUrl` + `env.manageSubscriptionUrl` behavior — zero regression for current TestFlight users.
- [x] **App.tsx wires entitlement-changed event** — `useEffect` listens for `NATIVE_PAY_TIER_CHANGED_EVENT` and calls `reprobePayTier()`, which bumps `payTierProbeKey` and re-renders the whole app with the right tier. Purchases unlock Plus features immediately; restores too.
- [x] **`.env.testflight` keeps `VITE_PAY_TIER=plus`** during transition so the 5 beta testers don't lose Plus while you wire up the dashboard. The `VITE_REVENUECAT_API_KEY_IOS` line is added but commented out in both `.env.example` and `.env.testflight` — uncomment after step 4 below.
- [x] **TS clean, 50/50 tests passing, build clean.** Bundle index chunk gained ~11 kB raw / ~4 kB gzipped (the RevenueCat SDK + wrapper).

### Remaining (your dashboard / Apple console work)

These four steps cannot be done from this codebase — they need your admin access. Until all four are complete, the `iap.ready` flag stays false and AboutSheet shows the legacy URL fallback (existing TestFlight users see no behavior change).

- [ ] **App Store Connect** → My Apps → StormPath → Features → In-App Purchases → create a Subscription Group (e.g. "StormPath Plus") and one or more auto-renewable subscription products inside it. Suggested:
  - `stormpath.plus.monthly` — Monthly tier 4 ($4.99/mo) or wherever your pricing lands.
  - `stormpath.plus.yearly` — Yearly tier 38 ($39.99/yr) for a ~33% annual discount.
  - Add localized display name + description in English first; Apple's reviewer reads these.
  - Configure the **introductory offer** (free trial recommended — 7 days is industry standard for nav apps) and any promo offers.
- [ ] **RevenueCat dashboard** (app.revenuecat.com) → Sign up → create a Project for the iOS bundle id `com.stormpath.app` (or whatever your `PRODUCT_BUNDLE_IDENTIFIER` is) → import the App Store products → attach them to an Entitlement named exactly `plus` (lower-case — must match `STORMPATH_PLUS_ENTITLEMENT_ID` in `src/billing/revenueCat.ts`) → create an Offering, add the product packages, mark it **current**. *(See the 2026-07-24 note at the top of this doc — you may already have this account from SiteBible setup; just add a new project, don't re-sign-up.)*
- [ ] **RevenueCat dashboard** → Project Settings → API keys → copy the iOS public SDK key (starts with `appl_`) → paste into `web/.env.testflight` as `VITE_REVENUECAT_API_KEY_IOS=appl_…` (uncomment the line). The same key goes into `web/.env.production` if you create one.
- [ ] **Sandbox test on a real iPhone** — App Store Connect → Users and Access → Sandbox Testers → create a sandbox account → on iPhone go to Settings → App Store → Sandbox Account → sign in → run a TestFlight build → tap Subscribe in About → Subscription → confirm the purchase sheet appears, the entitlement flips, and Restore works after deleting + reinstalling the app.

### App Store Review notes (paste into App Store Connect when submitting)

> StormPath uses RevenueCat to broker auto-renewable subscriptions through Apple StoreKit. To test:
> 1. Sign in to App Store with the provided sandbox tester account.
> 2. Open the app → tap the "?" / About icon → scroll to Subscription.
> 3. Tap "Subscribe — $X.XX / mo" → confirm with Face ID / Touch ID. Plus features unlock immediately.
> 4. To verify Restore: delete the app → reinstall → open About → Subscription → tap "Restore purchases". Plus features re-unlock without a second charge.
> Plus unlocks NWS storm map, route forecasts, frequent-route learning, and additional toggles described in About → "What Plus adds".

**Done when:** a fresh install on a non-Plus device can purchase Plus, restore Plus, and entitlement persists across reinstall. **Code-side: ready.** Dashboard-side: 4 manual steps remain.

---

## Phase 8 · Headline features

Visible upgrades that justify Plus pricing.

- [ ] **Live Activities + Dynamic Island** — biggest single product win for a nav app. Requires a Swift target inside the Capacitor project (WidgetKit + ActivityKit). Capacitor‑side bridge writes turn step + ETA via App Group `UserDefaults`. Activity shows next maneuver on lock screen and in Dynamic Island while another app is in front. ~2–3 days focused work.
- [x] **Haptics** — `@capacitor/haptics` shipped (Phase 8.1). New wrapper at `web/src/feedback/haptics.ts` exposes `hapticTapLight`, `hapticTapMedium`, `hapticSuccess`, `hapticWarning`, `hapticError` (plus a reserved `hapticTapHeavy`). Each call is settings-aware (`useSettingsStore.hapticsEnabled`, default ON, persisted under `stormpath-setting-haptics-enabled`) and no-ops on web — only the iPhone Taptic Engine fires. Wired call sites:
  - **Go button** (`proceedGo`) — medium impact when the user commits to a route.
  - **Route promotion** (`handlePromoteRouteToPrimary`) — light tap when the user picks a different alternate from a line tap or compare bar.
  - **Hazard sheet** — light tap on `handleProgressStripCorridorClick`, `handleProgressStripStormClick`, and `handleAdvisoryNwsClick` when the driver opens a hazard sheet from the strip / advisory bar.
  - **Off-route auto-reroute** — warning two-tap on both the drifting and severely-off-route silent reroute paths in App.tsx (throttled by the existing `FAST_REROUTE_THROTTLE_MS` / `NAV_SEVERE_OFF_ROUTE_THROTTLE_MS` so it never rapid-fires).
  - **Purchase / restore outcome** (`useRevenueCat.applyOutcome`) — `hapticSuccess` on entitled flips, `hapticError` on failures and the "no purchases found" restore branch. Cancellations stay silent.

  AboutSheet → Settings now has a "Haptic feedback" toggle (between GPS high refresh and the side-view-handedness picker), included in the bulk `applySettings` payload.

  `npx cap sync ios` ran cleanly — Capacitor reports `@capacitor/haptics@8.0.2` registered alongside the existing five plugins. Tests still 50/50 green; tsc + production build clean.
- [ ] **Voice quality** — verify Web Speech API uses iOS Siri voices on iOS 17+; consider `@capacitor-community/text-to-speech` if SSML control needed.
- [ ] **Liquid Glass styling** — iOS 26 system aesthetic. Translucent panels via `backdrop-filter: blur(...)` saturate(180%); audit our sheets/bars.
- [ ] **Custom Mapbox night style** — branded "StormPath night" basemap, more navigation‑focused than default Mapbox dark.

**Done when:** an honest demo of the Plus experience feels worth paying for vs Apple Maps and Google Maps.

---

## Phase 9 · Live Updates (over‑the‑air)

Ship web fixes without App Store re‑review (Apple permits for non‑native code only).

- [ ] Evaluate **Capgo** (open source, ~$15/mo) vs **Ionic Appflow**.
- [ ] Add the SDK, configure update channel.
- [ ] Test rollback flow.
- [ ] Document the OTA workflow in `docs/`.

**Done when:** a JS‑only fix can ship to all installed devices in under 30 minutes without Apple review.

---

## Phase 10 · CarPlay (optional, separate effort)

Big lift. Only after Phases 1–9 are stable and product validated.

- [ ] Apply for the CarPlay nav app entitlement at developer.apple.com (separate approval).
- [ ] Build a Swift CarPlay scene as a separate target in the Xcode project.
- [ ] Bridge to existing routing/voice/turn logic via Capacitor plugin or shared file.
- [ ] Pass Apple's CarPlay nav app review (strict — they expect production traction).

---

## Risk index

| Item | Risk to current testers | Mitigation |
|------|-------------------------|------------|
| Privacy Manifest | None | Metadata only |
| `armv7` removal | None | Modern hardware unaffected |
| AdMob ID swap | None for Plus testers | Verify ATT call before swap |
| Preferences migration | **Data loss without shim** | Migration shim is non‑optional |
| App.tsx refactor | Subtle regressions | Phase 3 tests + standalone build |
| React 19 / Compiler | Edge‑case identity bugs | Verify Mapbox map lifecycle |
| TanStack Query | Cache‑freshness drift | Side‑by‑side test on dev |
| RevenueCat IAP | Plus loss if env‑var dropped early | Keep env‑var until App Store build |
| Live Activities | None (additive) | — |
| CarPlay | None (additive) | — |
| Live Updates | OTA bug = OTA fix needed | Use staged rollout channels |

---

## Working notes

- Dev: `npm run dev` defaults to Plus. Periodically run with `VITE_PAY_TIER=free` in `.env.local` to verify Basic still works.
- Refactors should ship to TestFlight as standalone "no visible change" builds — easier to bisect regressions.
- After each phase, send a short note to the 5 testers describing what changed and what to look for.
- Cross‑reference: `APP_STORE_CHECKLIST.md`, `MOBILE_STORE_RELEASE.md`, `BETA_READINESS.md`, `TESTER_NOTES.md`.

