# StormPath Brain (Forge)

**What this is:** A living notebook on Forge for Bill + Cursor agents. It holds ideas, research, and connections so we can improve StormPath over time.

**What this is not:** Not a feature inside the app. Not a runtime service. Nothing here is “plugged into” TestFlight or the App Store unless Bill later asks to *build* a specific idea into product code.

**How we use it**

- Capture ideas (even half-formed) so they don’t get lost between chats
- Link related thoughts (weather UX ↔ route advisory ↔ tiers ↔ map behavior)
- When Bill is ready to ship a change, pick an idea out of Brain and implement it in `web/` / docs as usual
- Active ship / bugfix work stays in chat and code — Brain is for *later* and *thinking*

**Current product focus:** App Store v1 stable first. Brain items below wait until Bill says so (or asks to pull one idea forward).

### Stability gate (optional cue before big Brain builds)

Say *“store is stable — open the Brain”* when v1 is good enough, or name a section anytime to work one idea:

- [ ] TestFlight from current `master` (map handoff fix `e2520ed`+)
- [ ] Wi‑Fi → weak cell: map/camera keeps following puck
- [ ] Alternate route at Go stays locked in Drive
- [ ] No show-stopper crashes on a real drive
- [ ] App Store path clear (signing, metadata, review)

---

## Dark Sky–inspired route nowcast (post-launch idea)

**Context (Aug 2026):** Dark Sky was loved for hyperlocal clarity (“rain in 12 minutes *here*”), minute-level curves, glanceable UI, and context that changed emphasis (rain vs wind vs temp). Apple Weather has much of the data but buries the answer. StormPath’s lane is **not** a weather app clone — it’s **Dark Sky clarity for the corridor you’re driving**.

### Not proposing

- Rebuild Dark Sky’s app or copy its visuals
- Swap core weather stack to Pirate Weather / Dark Sky API (Tomorrow.io, WeatherKit, NWS, radar stay primary)
- Big pivot away from navigation
- Paid speed-limit or weather vendors for this
- Shipping Brain as part of the app

### Possible StormPath angles (when we choose to build)

| Dark Sky habit | StormPath equivalent |
|----------------|----------------------|
| “Rain in 12 min here” | “Rain on **your route** in ~X min / at mile Y” |
| Next-hour precip curve | Along-route strip on **progress rail** (distance ahead, not clock at home) |
| One glance | Drive advisory banner + compact strip: what matters **on the road ahead** |
| Hyperlocal | Tie to **GPS along locked route**, not destination city only |
| Plain language | e.g. “Light rain ahead for 6 mi” — not a wall of metrics |

### Directions to decide before any build

1. **Nowcast-first advisory (Basic?)** — Lead with next weather event on route; hourly/7-day stay Plus if desired.
2. **Minute-style strip on progress rail** — Precip/radar bands aligned to miles ahead.
3. **Context switching** — Dry now + rain in 20 min on route → banner/voice; NWS polygon on route beats generic “30%.”
4. **Reduce tap depth** — Answer in 1–2 seconds like Dark Sky; avoid Apple-Weather layering.
5. **Optional experiment only:** Pirate Weather as dev backup forecast — not required for the *feel*.

### Open questions

- Hero message: rain timing vs hazard miles vs both?
- Tier: nowcast Basic, long-range Plus (align with `docs/PAY_TIERS.md`)?
- Surface: Drive banner only, progress rail, map overlay, or one shared headline?
- Scope: polish existing advisory pipeline vs dedicated “Route nowcast” panel?

### References (public, not code)

- [Nightingale — Dark Sky eulogy / data viz](https://nightingaledvs.com/dark-sky-weather-data-viz/)
- [Pirate Weather](https://pirateweather.net/) — open Dark-Sky-shaped API (optional later)

---

## How agents should treat Brain

- Read this file when Bill mentions Brain, post-launch ideas, or Dark Sky direction
- Add new sections below as ideas appear; connect them when related
- **Never** treat Brain content as something to auto-ship into the IPA
- Implement only what Bill explicitly asks to build from a Brain idea
