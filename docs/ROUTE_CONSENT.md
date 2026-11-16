# Route consent — product north star (Bill, 2026-11-15)

StormPath competes with Google Maps / Waze / Apple Maps on turn-by-turn,
but wins on the thing they don't do: **the route is yours. StormPath
advises; the driver decides.** Silent rerouting is the most-hated behavior
in incumbent nav apps — we don't do it.

## The rules

1. **Never change the driver's planned route without consent.** Any
   route change must be shown in the real-time driving view and approved
   by the driver before it takes effect.
2. **Exception — off-route / missed turn.** If the driver leaves the
   route, auto-recalculate is allowed *only to get them back onto the
   same route* (rejoin ahead on the locked leg — see
   `web/src/nav/detourRejoin.ts`). This is recovery, not rerouting.
3. **If the route genuinely must change** (rejoin impossible, road
   closed ahead, etc.) → show the new route in RT view and require
   approval. No silent swaps.
4. **No-choice situations still inform.** If the road is closed or there
   is literally no alternative, the driver must still be alerted and the
   situation shown — consent applies to *choices*, not to warnings.
5. **Dense urban areas — consent covers a corridor, not a polyline.**
   City grids make per-decision approval impossible (seconds per turn).
   The driver approves a *corridor* at Go time (or on entering a dense
   area): any street sequence inside it is free to change silently.
   Interrupt only for *material* changes — different corridor/highway,
   >N minutes added, changed destination approach, or leaving the
   approved corridor — and approval there must work by voice / car
   control, not screen tap. Same-ETA tactical swaps inside the corridor
   are execution, not rerouting.

## Current implementation (verified 2026-11-15)

Already aligned:

- Traffic delays **prompt** (`TRAFFIC_PROMPT_REROUTE_MINUTES = 10`), never
  auto-reroute. `TRAFFIC_BYPASS_ENABLED = false` (retired).
- Hazard/traffic alternates are CTA-driven (bypass chip, compare panel,
  approach reroute CTAs) — user-invoked only.
- Core never silently replaces a chosen alternate with "fastest"
  (`web/src/App.tsx` reroute guards).
- Off-route recovery uses `detourRejoin.ts` — picks a rejoin point *ahead
  on the locked route*, i.e. rule 2 as written.
- `autoRerouteEnabled` user setting exists in the settings store.

Watch items / gaps to verify before promoting this publicly:

- **Corridor consent (rule 5) is not built yet.** Today the locked route
  is polyline-based; dense-city behavior needs a corridor layer +
  materiality gate + voice approval before "never reroutes without
  asking" is literally true downtown.
- `MANUAL_OFF_ROUTE_CHOICES_ENABLED = false` — off-route auto-recalc is
  on by default. Confirm it always rejoins the *same* route and never
  substitutes a different "fastest" path.
- Brain P3 (interstate jam bypass) stays parked — if it's ever built it
  MUST go through rule 1 (RT view + approval). Do not ship a silent hop.
- Marketing copy can use this as the wedge: "advise, don't reroute."

## Why this is the wedge

Turn-by-turn basics (voice, lanes, ETA, offline) are table stakes —
needed so nobody bounces to Google mid-drive. The differentiator is the
situation layer: construction ahead on *your* route, winter conditions,
hazards — fused into a drive where the driver stays in charge. DOT feed
coverage (40+ states live) is the data moat underneath it.
