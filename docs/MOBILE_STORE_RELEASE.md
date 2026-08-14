# Mobile store release (Apple App Store · Google Play)

StormPath ships as **one app** with **Basic** (default) and **Plus** (paid or internal test). The web dev server (`npm run dev`) is **not** a consumer distribution — only TestFlight / App Store / Play builds matter for customers.

**Day-to-day dev vs TestFlight (same repo, mirrored Plus):** see `docs/DEV_AND_TESTFLIGHT_WORKFLOW.md` and use `npm run build:ios:testflight` for internal TestFlight builds.

## Tier resolution (`getPayTier()`)

Order of precedence (see `web/src/billing/payFeatures.ts`):

1. **`stormpath-pay-tier-override`** in `localStorage` — About → “Test pay tier” when the test panel is enabled (dev or explicit prod flag).
2. **`VITE_PAY_TIER`** at build time — `plus` / `pro` forces Plus for that binary (e.g. internal TestFlight track).
3. **Native store entitlement** — `readNativePlusEntitlementActive()` in `web/src/billing/storeEntitlement.ts`. RevenueCat (`revenueCat.ts`) sets this after purchase / restore / customer-info updates (`entitlements.active.plus`). The localStorage key `stormpath-native-plus-entitlement=active` remains a QA escape hatch only. **Customer App Store:** see [`APP_STORE_CHECKLIST.md`](APP_STORE_CHECKLIST.md).
4. **`import.meta.env.DEV`** — Vite dev server only: defaults to **Plus** so features are easy to exercise in the browser.
5. Otherwise **Basic** (`free`), including **production Capacitor builds** when no override and no entitlement.

## Before App Store / Play review

| Item | Action |
|------|--------|
| Test tier panel | **Off** in store binaries unless you intentionally ship QA. Set `VITE_PAY_TIER_TEST_PANEL=false` (default is off in production builds; only `=true` turns it on). |
| Internal Plus testing | Set `VITE_PAY_TIER=plus` in the CI / Xcode scheme that builds your **internal** TestFlight binary only — not the public customer track. |
| Customer binary | Omit `VITE_PAY_TIER` or set `free`; implement IAP and entitlement refresh → `setNativePlusEntitlementActive`. |
| Upgrade / manage links | Set `VITE_UPGRADE_URL` and optionally `VITE_MANAGE_SUBSCRIPTION_URL` in `web/.env` used for that store build. |
| In-app purchases | Apple / Google require IAP for digital features unlocked **in the app** — plan StoreKit 2 or a bridge (e.g. RevenueCat) and remove reliance on build-time `VITE_PAY_TIER=plus` for paying users. |

## QA on a device (no IAP yet)

After installing a **Basic** build:

```js
localStorage.setItem("stormpath-native-plus-entitlement", "active");
location.reload();
```

Clear:

```js
localStorage.removeItem("stormpath-native-plus-entitlement");
location.reload();
```

## Related docs

- `docs/PAY_TIERS.md` — feature matrix Basic vs Plus.
- `web/.env.example` — env vars for store builds.
