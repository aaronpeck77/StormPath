# CarPlay (StormPath)

Driving-first CarPlay is **Phase 10** — entitlement + native templates, not a SaaS bill.

## Goal (set Oct 10, 2026)

StormPath is on the App Store. The car screen is allowed only after Apple grants the **Navigation** entitlement. There is no download count or revenue number to hit. Apple reads the request and decides if the app is a real turn-by-turn navigator.

**Bill’s step, Account Holder only:**

1. Open [developer.apple.com/carplay](https://developer.apple.com/carplay/).
2. Request **Navigation** for bundle id `com.aaronpeck.stormpath`.
3. Agree to the CarPlay Entitlement Addendum.
4. Wait for Apple’s email. The key they add is `com.apple.developer.carplay-maps`.

Apple’s June 2026 guide says a navigation app must:

- Give turn-by-turn directions with the next maneuver
- Use the base view only for the map
- Offer a way to pan
- Speak prompts that share the car’s audio, and stay quiet when there is nothing to say
- Stop guidance immediately if the car’s own navigation takes over

Apple assigned the CarPlay entitlement on 2026-11-01. The car scene is wired on `master` (see below). It needs the CarPlay capability on the App ID and a regenerated App Store profile in the `APPLE_PROVISIONING_PROFILE` secret before a build will sign.

Stormy does not get a second entitlement. The voice-based conversational category is for apps that are only a voice. She talks inside this navigation app.

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
| `web/plugins/stormpath-mapbox-navigation/ios/.../StormPathCarPlay.swift` | Car screen: Mapbox map in the base view, next turn (distance, street, arrow) from the phone's Core session, trip ETA, pan, zoom, recenter. Stops the phone trip if the car's own navigation cancels it. |
| `StormPathCarPlaySceneDelegate` (same file) | Scene delegate named in `Info.plist` for `CPTemplateApplicationSceneSessionRoleApplication` |
| `web/ios/App/App/Info.plist` | `UIApplicationSceneManifest`: phone scene (`AppDelegate`, `Main` storyboard) + CarPlay scene |
| `web/ios/App/App/AppDelegate.swift` | Phone scene delegate; hands its window to the shared app delegate and forwards URLs to Capacitor |
| `web/ios/App/App/StormPath.entitlements` | `com.apple.developer.carplay-maps`, set as `CODE_SIGN_ENTITLEMENTS` on the App target |
| `@stormpath/car-session` | JS → UserDefaults snapshot; CarPlay reads the destination name from it |

The trip still starts on the phone. While no trip is running, the car shows the map following the puck. Voice stays Core's phone voice, which plays through the car. Idle exit is skipped while the car screen is connected.

## Before the first CarPlay build

1. Developer account → Identifiers → `com.aaronpeck.stormpath` → enable the CarPlay capability Apple added → Save.
2. Profiles → the App Store profile → Edit → Save → Download.
3. Replace the GitHub secret `APPLE_PROVISIONING_PROFILE` with the base64 of that file.
4. Then push. Without steps 1–3 the archive fails to sign.

## Test on device

Simulator: I/O → External Displays → CarPlay. On a car or CarPlay dongle: start a trip on the phone, check the next turn, distance, street, pan, and that the phone app still works with the screen locked.

## Product note

Apple expects a real navigation experience for `carplay-maps`. Ship CarPlay when Go + voice + advisories already feel solid on the phone.
