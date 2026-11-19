# Route consent — product north star (Bill, 2026-11-15)

StormPath competes with Google Maps / Waze / Apple Maps on turn-by-turn,
but wins on the thing they don't do: **the route is yours. StormPath
advises; the driver decides.** Silent rerouting is the most-hated behavior
in incumbent nav apps — we don't do it.

## The contract

1. **Never change the driver's planned route without the driver knowing.**
   How loudly we ask depends on context (below) — but a change is never
   invisible.
2. **Exception — off-route / missed turn.** If the driver leaves the
   route, auto-recalculate is allowed and the driver's pick is adopted
   forward from where they are — a deliberate deviation *is* the consent
   (Bill, 2026-11-19: "the map needs to handle shortcuts without getting
   messed up"). The keep/return offer only earns the card when staying on
   the driver's pick costs meaningfully more distance than finishing the
   corridor they locked (`deviationIsCostly` in `nav/routeConsent.ts`) —
   the likely-accidental wrong turn the offer exists for. Recovery no
   longer prefers dragging the driver back onto the old corridor.
3. **No-choice situations still inform.** Road closed, no alternative →
   alert and show. Consent applies to *choices*, not to warnings.
4. **The offer can never stall progress.** Any approval UI is
   non-blocking: the newest (fastest-from-here) route keeps guiding while
   the offer is up, and timeout = keep it.

## Tiered model (Bill, 2026-11-15)

Consent is **context-tiered**, because interaction cost differs wildly:

- **City** — rerouting is fully automatic; the driver cannot interact.
  Still prefer holding the chosen path, but no card ever blocks. Eyes-free
  voice alerts carry the "route changed" knowledge.
- **Town / rural** — inform: "route line changed, same destination."
  Non-blocking notice (voice + transient hint).
- **Highway / interstate** — offer *only when the change costs the driver*:
  a driver-initiated deviation whose new line is not meaningfully longer
  than the remaining corridor is adopted with notify only. When it is
  costly, the RT view offers "Return to original route" vs keeping the
  new line; it times out (~20 s) → keeps the fastest route already
  installed. "Return" replans through a rejoin point ahead on the
  previous corridor.
- **Universal** — prefer keeping the driver on the chosen path before
  sending them down a different road.

## Implementation (feature/route-consent, 2026-11-15)

- `web/src/nav/routeConsent.ts` — pure tier + materiality + UX decision
  (`consentTierForContext`, `classifyRouteChangeMateriality`,
  `routeChangeUxFor`, `proposedRejoinsPreviousCorridor`), unit-tested.
- `useOffRouteNavigation` — `softRestartRouteFromHere` captures the
  previous locked corridor before replanning, classifies the new line,
  and raises `RouteChangeOffer` on highway+material changes. New
  `rejoinPreviousCorridor` action routes GPS→rejoin-point→dest.
  `driverInitiated` replans never re-ask (the tap was the consent).
- `BottomToolbar` — offer card ("Route changed — same destination.
  Return to original / Keep new route"), auto-dismiss on timeout.
- Materiality reuses `routeGeometryAgreesWithLocked`; a line that leaves
  and rejoins still counts as material (it IS a different road).

Already aligned before this work:

- Traffic delays **prompt** (`TRAFFIC_PROMPT_REROUTE_MINUTES = 10`), never
  auto-reroute. `TRAFFIC_BYPASS_ENABLED = false` (retired).
- Hazard/traffic alternates are CTA-driven — user-invoked only.
- Core never silently replaces a chosen alternate with "fastest"
  (`web/src/App.tsx` reroute guards); mid-trip `routeChanged` disagreement
  is rejected → DIY owns → the consent path above.
- `autoRerouteEnabled` user setting exists in the settings store.

## Still open

- **True corridor consent** is approximated by the agreement classifier,
  not a real buffer polygon — revisit if tactical swaps leak.
- **Voice approval** not built — the offer is tap-based; city tier relies
  on eyes-free voice alerts already in place.
- **P3 jam bypass** should mount the same `RouteChangeOffer` surface when
  built — the shape is shared (`nav/routeConsent.ts`), the wiring is not.
  It must never be a silent hop.
- `MANUAL_OFF_ROUTE_CHOICES_ENABLED = false` — verify auto-recalc always
  prefers rejoin and the offer only fires on material changes.

## Why this is the wedge

Turn-by-turn basics (voice, lanes, ETA, offline) are table stakes —
needed so nobody bounces to Google mid-drive. The differentiator is the
situation layer: construction ahead on *your* route, winter conditions,
hazards — fused into a drive where the driver stays in charge. DOT feed
coverage (40+ states live) is the data moat underneath it.
