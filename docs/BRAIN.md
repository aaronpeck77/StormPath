# StormPath Brain — deferred ideas (not in active scope)

**Current focus:** App Store ship + stability (TestFlight soak, Wi‑Fi→cell map, route lock, Lim accuracy, etc.).

**Do not start Brain items until Bill says the store build is stable** — then revisit this file.

### Stability gate (Bill confirms when ready)

Say *“store is stable — open the Brain”* when these are good enough for v1, not perfect:

- [ ] TestFlight build from current `master` (map handoff fix `e2520ed`+)
- [ ] Wi‑Fi → weak cell: map/camera keeps following puck (no restart needed)
- [ ] Alternate route at Go stays locked in Drive
- [ ] No show-stopper crashes on a real drive
- [ ] App Store submit path clear (signing, metadata, review notes)

Until then: **ship and soak only** — no Brain UX work.

---

## Dark Sky–inspired route nowcast (post-launch)

**Context (Aug 2026):** Dark Sky was loved for hyperlocal clarity (“rain in 12 minutes *here*”), minute-level curves, glanceable UI, and context that changed emphasis (rain vs wind vs temp). Apple Weather has much of the data but buries the answer. StormPath’s lane is **not** a weather app clone — it’s **Dark Sky clarity for the corridor you’re driving**.

### What we are NOT doing

- Rebuild Dark Sky’s app or copy its visuals
- Swap core weather stack to Pirate Weather / Dark Sky API (Tomorrow.io, WeatherKit, NWS, radar stay primary)
- Big pivot away from navigation
- Paid speed-limit or weather vendors for this

### What we might do later (product / UX only)

| Dark Sky habit | StormPath equivalent |
|----------------|----------------------|
| “Rain in 12 min here” | “Rain on **your route** in ~X min / at mile Y” |
| Next-hour precip curve | Along-route strip on **progress rail** (distance ahead, not clock at home) |
| One glance | Drive advisory banner + compact strip: what matters **on the road ahead** |
| Hyperlocal | Tie to **GPS along locked route**, not destination city only |
| Plain language | e.g. “Light rain ahead for 6 mi” — not a wall of metrics |

### Concrete directions to decide before build

1. **Nowcast-first advisory (Basic?)** — Lead with next weather event on route; hourly/7-day stay Plus if desired.
2. **Minute-style strip on progress rail** — Precip/radar bands aligned to miles ahead.
3. **Context switching** — Dry now + rain in 20 min on route → banner/voice; NWS polygon on route beats generic “30%.”
4. **Reduce tap depth** — Answer in 1–2 seconds like Dark Sky; avoid Apple-Weather layering.
5. **Optional experiment only:** Pirate Weather as dev backup forecast — not required for the *feel*.

### Open questions (for Bill when we revisit)

- Hero message: rain timing vs hazard miles vs both?
- Tier: nowcast Basic, long-range Plus (align with current PAY_TIERS)?
- Surface: Drive banner only, progress rail, map overlay, or one shared headline?
- Scope: polish existing advisory pipeline vs dedicated “Route nowcast” panel?

### References (public, not code)

- [Nightingale — Dark Sky eulogy / data viz](https://nightingaledvs.com/dark-sky-weather-data-viz/)
- [Pirate Weather](https://pirateweather.net/) — open Dark-Sky-shaped API (optional later)

---

## How to use this file

- Agents: read `docs/BRAIN.md` when Bill asks about “Brain,” post-launch ideas, or Dark Sky direction.
- Add new deferred ideas as sections below; keep active ship work out of here.
