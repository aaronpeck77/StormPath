# Tester Notes — StormPath Closed TestFlight

Short version: a single source for two audiences.

1. **You (Aaron)** — the pre-invite smoke checklist + what to paste into each TestFlight build's "What to Test" field.
2. **Your testers** — what the app is, what to focus on, and how to report things back.

Related: [BETA_READINESS.md](BETA_READINESS.md) (owner checklist), [DEV_AND_TESTFLIGHT_WORKFLOW.md](DEV_AND_TESTFLIGHT_WORKFLOW.md), [MOBILE_STORE_RELEASE.md](MOBILE_STORE_RELEASE.md), [PAY_TIERS.md](PAY_TIERS.md).

---

## For you — before each TestFlight invite round

Do this short smoke pass on the actual device before inviting anyone (or after pulling a new build):

- App launches without crashing; the home screen shows the season-themed StormPath logo + cloud.
- Address bar accepts both an address and a business name (closest-first results).
- With a route loaded: open the address bar, then tap **×** on the right — bar collapses to the one-line destination (not stuck open).
- Tap a result → routes A/B/C build → tap **Go** → drive view follows the puck smoothly.
- **Compare routes on map** (hazard sheet or advisory): three different lines on the map, tap A/B/C to highlight, **Go** to switch route and return to drive.
- Cycle the view button (Rt / Dr / Mp). Drive view shows only the active leg; route/topdown show alternates.
- Advisory bar always shows *something* useful — local weather, NWS, traffic, or the SiteBible/coming-soon fallback. Never blank.
- Tap the advisory bar to expand. Confirm the panel fits, scrolls if needed, and closes cleanly.
- Pick a **north/south** destination from the home screen. The lower endpoint should sit clearly above the inline route-select button (not touching it).
- Progress rail (right edge, Plus only) appears once you're navigating; tap a colored chunk → details open.
- Tap the `i` button → About sheet opens, Map key swatches render, **Help → Show tips again** re-arms the coachmarks.
- About → **Support diagnostics** → Email button opens your mail app with diagnostics pre-filled.

If all of the above pass, the build is good to invite.

### What to paste into TestFlight "What to Test"

Edit per build, but the structure below works as a starting template:

```
This build adds [the 2-3 most user-visible things in this build].

What to focus on:
- Drive a familiar route and tell me anywhere the map/turn directions felt wrong.
- Open the advisory bar (the colored strip near the top) and tell me if anything
  there read as confusing or wrong.
- Try **Compare routes on map** if you hit a hazard — do the three options look different, and does Go switch you cleanly?
- If the address bar gets in the way, use the **×** on the right to collapse it.
- Try searching for a business name, not just an address.
- Tap the `i` button (bottom-left) — everything you need to configure or
  understand the app lives there.

How to report:
- In-app: tap `i` → scroll to "Support diagnostics" → write your note → tap
  "Email feedback with diagnostics". That sends me your message plus a small
  config dump (no personal info) so I can debug fast.
- Or just text/iMessage me a screenshot.

Known limitations in this build:
- US-only weather alerts (NWS).
- Subscription / Plus billing isn't real yet — everyone on this build has Plus.
- Some weather data lags up to ~10 min behind real conditions.
- Serious app errors may be reported automatically to the developer (no personal info). Please still email feedback for anything confusing or wrong.
```

---

## For testers — the short version

### What StormPath is

A multi-route driving app with live weather, traffic, and road-hazard awareness baked into the route. Built around three views (Route plan, Drive, Map top-down) and a single advisory bar at the top that summarizes "what's happening on my drive right now."

### What you can do

- **Plan a trip.** Type an address or a business name. The app shows up to three route options (A/B/C). Tap one to make it active, then tap **Go** to start.
- **Drive.** The blue puck is you. The blue line is your active route. Colored bands under the line mean weather, traffic, or hazards ahead.
- **See conditions.** The top advisory bar rotates through local weather, route forecasts, NWS alerts, traffic delays, and tips. Tap it to expand.
- **Save places and routes.** Tap the star button to save a destination or a route you've driven for one-tap access later.
- **Change route while driving.** Hazard popup or advisory → **Compare routes on map** → pick A, B, or C → **Go**.
- **Dismiss search.** Tap **×** on the address bar to collapse it when you don't need to change destination.
- **Switch views.** The two-letter button (Rt / Dr / Mp) cycles between route plan, drive, and top-down map.
- **Find anything you need.** The `i` info button (bottom-left) opens settings, the **map color legend**, your saved places, the activity-trail toggle, the help/tips replay, and the support form.

### What to focus on this round

- Does the **map and the route feel right** when you drive a familiar trip?
- Is the **advisory bar** ever confusing, blank, or showing something that doesn't match reality?
- Does the **business search** find what you'd expect, in roughly distance order?
- Anything that **crashes, freezes, or just feels off**.

### How to report something

**Easiest path, in-app:**

1. Tap the `i` info button (bottom-left of the map).
2. Scroll to **Support diagnostics**.
3. Type a short note describing what happened (where you were, what you tapped, what you saw vs. expected).
4. Tap **Email feedback with diagnostics**.

That sends a message plus a small build-config dump (no personal info — just app version, settings, and feature flags) so issues can be debugged fast.

**If you can't email:** screenshot the issue and text/iMessage it over. Mentioning roughly where you were and what you were doing helps a lot.

### Known limitations in this build

- **US weather only.** Severe-weather alerts come from the US National Weather Service. The app works outside the US, but you won't see NWS alerts there.
- **Billing isn't real yet.** Every TestFlight build is Plus-enabled so you can test the full app. Subscription/upgrade buttons in About are placeholders — don't tap them expecting a real checkout.
- **Some weather data lags.** Local-weather readings refresh every ~10 minutes. Severe-weather polygons refresh more often.
- **Don't use it while driving.** Look, plan, then go. If you need to change settings mid-trip, pull over.

### Privacy

Location is used in-app only — for showing your puck, routing, and pulling weather/traffic near you. Anything Plus-related (activity trail, frequent routes) stays on your device. Full statement: About → **Privacy, safety & data**.

---

## Operational reminders (for me)

- TestFlight builds: `cd web && npm run build:ios:testflight` then archive in Xcode.
- Plus is forced on for testers via [.env.testflight](../web/.env.testflight) — do **not** ship that env to App Store.
- Coachmark replay key: About → Help → Show tips again.
- Force-clear all coachmarks for a clean tester first-launch: in Safari Web Inspector (`http://localhost:5173` in dev),
  `Object.keys(localStorage).filter(k=>k.startsWith('stormpath:coachmark:')).forEach(k=>localStorage.removeItem(k))`.
