# Weather, radar animation, and routing — vision vs. current limits

## What you’re aiming for

- **Animated radar** that shows echo motion while you drive.
- **Routes that keep adjusting** as the storm evolves and as the vehicle moves — fast, fluid, and trustworthy.

That end state implies a **closed loop**: live reflectivity → cost field on the road graph → shortest-path refresh at high frequency → validation against new frames. Consumer routers (ORS, Mapbox Directions) **do not** implement that loop; they optimize distance/time/traffic rules only.

## What this app does today

| Piece | Behavior |
|--------|-----------|
| **RainViewer** | Past frames (~10 min apart) are **looped on the map** when Rad is on; **nowcast** frames are included automatically when RainViewer’s API returns them (often empty). |
| **Tile resolution** | RainViewer is capped at **zoom 7**; the map **overzooms** for street view. You cannot resolve alley-scale gaps between cells. |
| **OpenWeather** | Samples along each route polyline drive **text + a precip weight** for scoring and hazard copy — not pixel-level radar. |
| **Routing** | Trip lines come from **ORS/Mapbox**; they **do not** read radar tiles. There is **no** continuous reroute from storm motion. |

## When the “model” breaks down (product definition)

Use these as **guardrails** for UX and future engineering:

1. **Router blindness**  
   Any time you expect the line to “move off the red on radar,” the **baseline model has already failed** — not because the map is wrong, but because **routing APIs are the wrong abstraction** for mesoscale weather.

2. **Storm too close / too fast**  
   If the driver is **inside or minutes from** heavy echoes, **lateral escape** may be impossible on the available graph, and cells **move faster** than safe replanning + network round-trips. The honest state is: **human decision** (stop, delay, detour manually, wider corridor), not another automatic line.

3. **Coarse grid**  
   At z≤7, **“threading” between two cells** is often **illusory**. The UI should not imply street-level precision.

4. **Data latency**  
   Composite radar products lag real echoes. **Animation shows history** (and short nowcast when provided), not a guarantee at your ETA.

5. **Winter**  
   Ice/snow **strip friction and closures** in ways **static graphs** miss. Same outcome: **fail closed** to driver judgment and conservative copy.

The in-app **Hazards** feed surfaces rows tagged **Model**, **Rad loop**, **Storm**, and **Breaks down** so drivers see these limits **while** looking at ETAs and alternates.

## Path toward your vision (engineering sketch)

- **Raster sampling**: Along each candidate polyline, sample RainViewer (or NOAA) tiles → aggregate **exposure** along the leg; refresh on a **bounded interval** (e.g. 1–3 min), not every frame, to stay fluid without melting the network.
- **Cost field**: Turn exposure + time-to-intercept into **edge weights** or **penalties**; run **your own** route or post-process alternatives from a standard router.
- **When to stop auto-rerouting**: If **time-to-enter** heavy echo &lt; threshold or **no path** under a max detour multiplier → **freeze** auto suggestions and show **explicit** “manual only” state (aligned with **Breaks down** above).

Until then, treat **animated radar** as **situational awareness**, and **routes** as **traffic/geometry** — not as a storm-avoidance control loop.
