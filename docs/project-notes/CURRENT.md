# StormPath — current handoff

Updated: 2026-10-31, afternoon, Forge (this PC). Pushed to GitHub with the yearly price copy because Bill asked.

Read this at the start of a new chat when Bill says to continue or before changing the app. Update it at the end of a session with what changed and what is still open. Keep it facts and decisions. Do not paste this file back into the chat. Do not put tokens, the EIN, the D-U-N-S number, or the SSN in here.

Bill asked on 2026-10-31 to put this file on GitHub so Devin and the next Forge chat can read it. Devin only sees what is pushed.

## Why this file exists

Long chats resend the whole thread on every message, so credits run out on short questions. Bill will start new chats often and point them here. Cursor on Forge and Devin on GitHub both hit usage limits. Work bounces between them. GitHub is the shared code. This file is the shared memory.

## Where the code is

- Repo: `https://github.com/aaronpeck77/StormPath.git`
- **Working branch is `master`.** Bill said on 2026-10-28 night that master is the branch we move forward on, and the latest work is there. Stay on `master`. Do not check out `native/drive`. Do not start a feature branch unless he asks.
- Forge checkout: `C:\My Apps\StormPath - v3`, branch `master`. The 2026-10-28 tip was `5ed6406`. The next commit on `master` is the 2026-10-31 yearly price copy Bill asked to push.
- GitHub `master` before that price commit: `5ed6406` (2026-10-28, author Devin), “Keep complete landscape turn instructions readable.”
- `native/drive` at `9b24d1c` is an ancestor of that `master` (0 ahead, 49 behind). Master already has the native/drive work plus Devin’s Oct 23–28 kit. Leave `native/drive` where it is.
- Local dirty files still not in git, do not commit unless he asks: `.gitignore`, `docs/BRAIN.md`, `docs/BRAIN_THINKING.md`, `AGENTS.md`. This notes folder was pushed on 2026-10-31 with the yearly price copy.
- A push to `master` fires TestFlight. Do not push, and do not ship App Store or TestFlight, unless Bill asks. Do not deploy Netlify or the Cloudflare rainviewer worker unless he asks.

## What Bill said on 2026-10-28

He likes what Devin did. Expect to bounce the app between Devin and Cursor because both platforms cut usage and he runs out of credit. He wants new chats to read this folder instead of growing one thread.

Night of 2026-10-28: master is the working branch. This PC had still been on `native/drive`. He asked to switch to master before changing anything, update these notes, and not commit or push until he asks. That switch is done. Next chat starts on `master` at `5ed6406`.

Nothing else that night. The last push to GitHub is Devin’s, commit `5ed6406`. Bill has not tested it. He will testdrive on 2026-10-29 and come back with a day’s diagnostic dumps. Until those dumps are in, do not edit the app, do not commit, and do not push. When he returns, keep working on `master` the way the work was done with Devin: read the dumps and use that feedback to tweak and improve. Do not stack new features ahead of that drive.

## Plan after the 2026-10-30 evening GitHub check

No new commits, no open issues, Actions green. Six old pull requests are still open and still based on `907444d` (before the Oct 24 master moves). Leave them. Do not merge.

Next product step is still the drive, not more code. Install or confirm TestFlight **551** from `master`, drive it, bring the diagnostic dumps. Then tweak only what those dumps show. Apple organization membership stays the separate track: D-U-N-S, then Switch to organization. CarPlay Navigation stays unrequested until Apple’s email path is used. Do not push.

## What Bill said on 2026-10-31

He set the yearly Plus price in App Store Connect. Apple had no $49.90 price point, so he chose **$49.99**. It starts Monday 2026-11-02. Until that morning the store still charges **$39.99**. Monthly stays **$4.99**. The one-month free offer stays on the monthly plan only, and only when Apple says that phone is eligible.

Yearly is ten months of the monthly price, which is two months included. $49.99 is nine cents over $4.99 × 10. He asked to keep that deal. Do not put the yearly price back to $39.99 or $49.90.

He then asked to push this copy to GitHub so TestFlight builds, deploy the public terms page, and put these notes on GitHub. The commit changes the in-app fallback and the yearly button to **$49.99** and **2 months included**, plus `web/public/terms.html`. `web/src/` also changed, so the TestFlight build is the one that carries the button text. Netlify rebuilds because `web/public/terms.html` changed. Do not deploy the Cloudflare rainviewer worker. Do not ship an App Store binary unless he asks. The drive of the previous build and the diagnostic dumps are still outstanding. Do not stack more features ahead of those dumps.

## What Bill said on 2026-10-30

No diagnostic dumps in this chat. No app code was changed. The drive-test gate above still stands.

StormPath is already on the App Store. There are no customers yet. Public site remains `https://stormpath2.netlify.app`.

CarPlay: Apple Developer Relations emailed him. Case-ID 22965569. They are reviewing a CarPlay navigation request and asked for a reply with Drive screenshots of turn-by-turn guidance (distance, street name), a description of upcoming-maneuver voice, and the App Store link. He already sent the store URL. Do not press + on Audio, Driving Task, Voice Based Conversation, or any other CarPlay row. Entitlement stays off until Apple grants Navigation (`com.apple.developer.carplay-maps`). Follow-up emails must include the line `Case-ID: 22965569`.

WeatherKit: the App Services tab showed the WeatherKit box unchecked. The app does use WeatherKit for forecasts, through the Netlify token, not a key inside the phone app. He was told not to press Save. Do not enable that box unless he asks. MusicKit and ShazamKit stay off.

He was filling out Devin for Startups (credits). Not confirmed submitted. Do not rewrite that form unless he asks. He is not on LinkedIn or Twitter. GitHub `https://github.com/aaronpeck77` is the public page if a form will not accept a blank link.

Apple company check is in progress and paused on a D-U-N-S number. See below. Do not restart that from memory of the EIN.

## Apple — seller name

Bill does not want his personal name on the App Store. The seller name is the Apple Developer membership. An individual membership shows his legal name. PeckTeck LLC shows only after the membership is an organization.

He is on the right screen. Developer account → Membership details → Update your information. Two cards: “Change contact details” and “Switch to organization membership.” Use the right card, then Provide updates. Changing the name at account.apple.com does not change the store seller. The Apple Business page “Verify PeckTech LLC” (`business.apple.com`) is a different product. Its app list is empty. Its Business ID check said it takes an EIN and then returned “Unable to validate at this time.” It does not change the App Store seller. On 2026-10-30 evening an email (not a page on the site) showed “Provide verification information” and warned that the organization is deleted if it is not verified by the date in Organization settings. The email does not print the date. That date is at business.apple.com → Settings → Organization. Apple’s published window is 60 days after that organization was created. What that warning deletes is the Apple Business organization and its work accounts. It does not delete the Developer membership or the App Store app. Verification there asks for two methods. A D-U-N-S number can be one. The seller-name change is still Switch to organization membership after Apple can see the D-U-N-S number.

The organization form asks for a D-U-N-S number. The EIN is not that number. He has an EIN. He does not have a D-U-N-S yet.

Free request: `https://developer.apple.com/enroll/duns-lookup/` and Apple’s page `https://developer.apple.com/help/account/membership/D-U-N-S/`. Do not pay a site to rush it. Apple says paying does not shorten the wait: up to 5 business days for the number, then up to 2 more before Apple can see it. Use the legal name on the state filing. He has typed both PeckTeck and PeckTech. The paper wins. He must be the founder. After the number is in Apple’s system, go back to Switch to organization membership. Do not ask him to paste the EIN or the D-U-N-S number into chat.

## Devin’s kit (Bill likes it)

On `master` only, about 4,000 lines, Oct 23–28. Do not revert it. Do not rebuild it on `native/drive` unless he asks. Open cautions, not a rejection:

- Jam offer stays quiet until the slow stretch is inside 5 miles. Dismiss sticks to the stretch. Leave rules are unchanged: next exit still ahead, take it when close, stay in the queue when that exit is the end of the jam. `TRAFFIC_BYPASS_ENABLED` stays false. Do not auto-take.
- Landscape dock keeps the turn line beside the controls. Plus drive can show the next real hazard when the next turn is still more than a mile out.
- Monthly trial copy shows only when the store says the phone is eligible. TestFlight iOS builds now receive `VITE_REVENUECAT_API_KEY_IOS` if that secret exists. Yearly includes two months at **$49.99**, starting 2026-11-02. See the 2026-10-31 section. Do not change that price in copy or in App Store Connect unless he asks.
- Offline: two mechanisms. The native TileStore corridor pack downloads at Go only when `NATIVE_DRIVE_MAP_ENABLED` is true. That flag is still false, so the pack does not run. What does run is an IndexedDB copy of Mapbox map resources in the web map: zoom 13 and below, 500 pieces (40 essentials, 300 home, 160 corridor), dropped after 30 days, traffic tiles excluded. Offline camera clamps to zoom 13.9. That is a city-zoom fallback, not a drive-zoom trip download. The Swift pack took several API-fix commits. Do not flip the native-map flag, and do not treat this as finished P2, until he asks and a dead-zone drive has been done.
- If Core sends a new line mid-trip and the app refuses to draw it, master hands the puck and banner back to the in-app guide and turns Core’s voice off for that trip. Core keeps running. The first line of a trip can still be refused without that handoff. This needs a real drive before a store or TestFlight build is cut from master.

## Phone builds

2026-10-31: Bill asked to push the yearly price copy. That push starts a new TestFlight. Build number is `github.run_number`. The previous green TestFlight was run `40786369918` (run number 551) on `5ed6406`. Do not dispatch another workflow by hand.

Older Forge chat build 520 (run `39694149881`, commit `9b24d1c` on `native/drive`) is behind master. The drive to report is 551 on `master`, if that build is the one on the phone.

Build 520 includes, on top of 519: user-selected downloaded voice, Horizon km/h-mislabeled-as-m/s fallback, refresh no longer rewinds the banner, town reroute lookback, idle hard-exit. Build 519 commit `cfe54ec` removed the assistant dock.

## Locked product decisions

- Voice is exactly one of No voice, Basic, Downloaded. Default No voice. Downloaded uses the iPhone Spoken Content voice. A Siri voice cannot be used. Basic still uses the compact en-US voice. Stormy map button shows only when Basic or Downloaded is on. Grok/ChatGPT dock stays off the UI. Server grok code can remain. Do not turn the dock back on unless he asks.
- Add-a-stop UI stays only before Go. After Go, do not splice the locked line. A mid-drive coffee stop re-measures from current GPS, coffee is a via, original destination stays the end, then the drive resumes. Do not use handleStopAndClear.
- Jam hop: severe congestion at least 80, a real stretch, leave the dead mainline via Mapbox `exclude=point`. If already in the queue, wait for the next exit still ahead. Take it when within about 0.5 mi and at least about 2 miles of jam remain past that exit. Otherwise stay in the queue. One new measurement to the same destination, then handleGo. Do not restore the old pin-window or motorway-ban hop.
- Horizon is on in the native plugin: length 10 km, expansion 0, branch 50 m, min time delta 2 s, `enableEnhancedDataAlongEH` false. Posted speed: Horizon mph wins with no “est”. Else Directions maxspeed labeled “est”. Else US road-class average labeled “~est” (interstate 70, US/state 55, county 55, local 30). Hide class estimates outside the US. Do not invent a limit when Horizon returns nil. `locationMatching.speedLimit` is not proof the sign is known. Live incidents stay off until Bill pastes a real Mapbox graph name. Do not guess one. Do not paste the access token.
- Idle quit: no trip and off screen about 20 seconds, native `exit(0)` only if the app is in the background. A drive after Go stays alive. GPS watch stops when backgrounded with no trip.
- CarPlay entitlement stays off until Apple grants it. Case-ID 22965569 is the open Navigation review. Do not request a different CarPlay category.
- P2 offline trip download was talk-only on Forge (“just talking”). Devin built a version on master. Bill likes Devin’s kit. Still do not flip the native pack on or bake a region into the 85 MB app unless he asks.
- Radar tile scale: Netlify `rainviewer-tile` is the launch path. Cloudflare worker in `cloudflare/rainviewer-tiles` is a reminder only if radar shuts off, 429s, or store scale. Do not deploy it unless he asks. Docs: `docs/CLOUDFLARE_TILES.md`.

## Public site and store size

- Site: `https://stormpath2.netlify.app` (privacy, terms, support under that host). Do not deploy unless he asks.
- He reported the App Store size as 85 MB. That is the compressed download. Installed size is larger. Do not fill spare size with a regional map or a local model.

## Do not

- Commit `.env`, Apple keys, or certificates.
- Commit or push unless he asks. That includes this notes folder and `docs/BRAIN.md` / `docs/BRAIN_THINKING.md`.
- Leave `master`. Do not switch back to `native/drive`, open another branch, revert `master`, or push it unless he asks. A push to `master` starts TestFlight.
- Print secrets. Do not ask him to paste the EIN, D-U-N-S, or SSN.
- Enable enhanced ADAS. Invent an incidents graph id. Turn on `TRAFFIC_BYPASS_ENABLED`. Restore the old surgical jam hop. Re-enable the Grok dock.
- Start a Cursor Automation or `/loop` to “keep thinking.” That burns credits. Only if he asks.
