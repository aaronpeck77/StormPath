# Storm corridor intersect (experimental)

Predicts where **moving radar echo** meets your **drive timeline** along the route
(same pattern as `forecast/routeSunEvents.ts` for sunset/sunrise).

## Kill switch (default OFF)

- Env: `VITE_STORM_CORRIDOR_INTERSECT=true`
- Or localStorage: `stormpath-storm-corridor-intersect=1`

Does **not** change Mapbox routing or `stormAvoidanceWaypoint` — advisory + Route Info only.

## Delete this feature

1. Remove this folder: `web/src/features/stormCorridorIntersect/`
2. Remove `web/src/nav/stormCorridorIntersectBridge.ts`
3. In `useRouteAheadDerivations.ts` — remove the `applyStormCorridorIntersectBridge` import and call
4. In `RouteProgressGlancePanel.tsx` — remove storm intersect overlay block + import
5. In `config/env.ts` — remove `stormCorridorIntersectEnabled` if added
6. Delete `web/src/features/stormCorridorIntersect/__tests__/`

No other files should import from here.
