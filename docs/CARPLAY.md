# CarPlay (StormPath)

Driving-first CarPlay is **Phase 10** — entitlement + native templates, not a SaaS bill.

## Cost

- No monthly CarPlay fee.
- Uses your existing **Apple Developer Program** (~$99/year).
- Requires Apple to grant the **navigation** CarPlay entitlement for bundle id `com.aaronpeck.stormpath`.

## Request the entitlement

1. Sign in as Account Holder at [developer.apple.com/carplay](https://developer.apple.com/carplay/).
2. Request the **Maps / Navigation** category entitlement (key: `com.apple.developer.carplay-maps`).
3. Agree to the CarPlay Entitlement Addendum.
4. Wait for Apple’s email. Timing varies; nav apps are reviewed carefully.
5. After approval: enable the capability on the App ID, regenerate provisioning profiles, set `CODE_SIGN_ENTITLEMENTS` to `App/StormPath.entitlements` (see template below), then ship a build that includes the CarPlay scene.

**Do not** enable the entitlement key in a shipping profile until Apple assigns it — signing will fail.

## What’s in the repo today

| Piece | Role |
|-------|------|
| `@stormpath/car-session` | JS → native UserDefaults snapshot (destination, advisory, maneuver) while Go is on |
| `web/ios/App/App/CarPlay/*.swift` | Stub `CPMapTemplate` scene that reads that snapshot |
| `StormPath.entitlements.example` | Template with `carplay-maps` — copy to `StormPath.entitlements` after approval |
| This doc | Request + wire-up checklist |

Phone Capacitor UI stays as-is. CarPlay is a **separate scene** that mirrors trip state; sharing live Mapbox Navigation Core with the head unit is a later step.

## After entitlement (wire-up)

1. Copy `StormPath.entitlements.example` → `App/StormPath.entitlements` and turn `carplay-maps` on.
2. Add CarPlay Swift files to the Xcode **App** target (if not already).
3. Add `UIApplicationSceneManifest` CarPlay session role pointing at `CarPlaySceneDelegate` (keep the phone window working — test on device).
4. Confirm Simulator → I/O → External Displays → CarPlay shows StormPath.
5. Later: share Mapbox Nav Core session with CarPlay maneuvers / map pan.

## Product note

Apple expects a real navigation experience for `carplay-maps`. Ship CarPlay when Go + voice + advisories already feel solid on the phone.
