# DOT signup checklist — coverage sprint to Dec 4

Goal: every free key registered + every keyless adapter built before free
credits end. ~24 days from 2026-11-10. **One signup ≈ 10–15 min of Bill's
time; I wire each key into the worker in ~2 min once pasted.**

Pace: ~20 signups total → **1–2 per night finishes with a week of slack.**
Start the slow-approval ones TONIGHT — they take days, not minutes.

**Policy (Bill, 2026-11-11): only integrate what is free AND works on the
current Free-plan worker.** Parked/blocked items stay parked — no paid-plan
upsell, no re-architecture for a single feed, unless Bill asks. A feed that
can't flow through the free worker is treated the same as no feed.

When a key arrives: paste it here (or into chat) with the state name —
I'll `wrangler secret put` + `/refresh` + verify live events.

---

## ⏰ TONIGHT — slow approvals (request forms take days)

| # | State(s) | What | Where | Gives us |
|---|----------|------|-------|----------|
| 1 | MN, KS, NE, IN (+MA?) | Castle Rock CARS credential request form | per-state 511 site → "developer"/"API" link | Road conditions + events XML feeds |
| 2 | FL (optional) | Email James.Landini@dot.state.fl.us for FL511 API key | — | Richer FL data (we already have keyless DIVAS + WZDx) |
| 3 | MT, WY | Contact MDT / Trihydro for road-weather API | app.mdt.mt.gov/atms | Low priority — no WZDx either |

## ⚡ Self-serve keys — WZDx work zones (plumbing already wired)

Worker `KEYED_FEEDS` already knows the auth scheme for each — a key alone
turns the feed on. Registry URLs for reference:

| # | State | Feed | Secret name | Registration |
|---|-------|------|-------------|--------------|
| ~~4~~ | ~~**NPS (national)**~~ | developer.nps.gov/api/v1/roadevents | `NPS_API_KEY` | ✅ **DONE 2026-11-10** — live, park road events verified (Grand Teton) |
| 5 | **Michigan** | mdotridedata.state.mi.us (Socrata) | `MDOT_API_KEY` | Socrata portal — instant token |
| ~~6~~ | ~~**Virginia**~~ | 511-atis-ttrip smarterroads | `VDOT_API_KEY` | ✅ **DONE 2026-11-14** — live via snapshot Action. The old worker-CPU blocker is gone: feeds now parse in the GitHub Action, not the 10 ms Worker. ~3.1k events verified. |
| — | **Oregon** | TripCheck API / WZDx v4 | `ODOT_API_KEY` | ⏸️ **PAUSED** — portal route to subscription key is unclear; revisit later |
| 8 | **California** | api.511.org | `MTC_511_API_KEY` | 511 CA developer program |
| 9 | **North Carolina** | drivenc.gov/api/wzdx | `NCDOT_API_KEY` | DriveNC API registration |
| 10 | **Colorado ×2** | data.cotrip.org (wzdx + cwz) | `CDOT_API_KEY`, `CDOT_CWZ_API_KEY` | manage-api.cotrip.org — self-serve; **one Cotrip key may serve both** |
| 11 | **Massachusetts** | api.massdot-swzm.com | `MASSDOT_CWZ_API_KEY` | MassDOT SWZ feed signup |
| 12 | **Pennsylvania** | atms.paturnpike.com | `PENNSTURNPIKE_API_KEY` | Turnpike API key request (toll roads) |
| 13 | **Illinois Tollway** | tims2go.tollway.state.il.us | `ILTOLLWAY_API_KEY` | Tollway traveler-info API program |
| ~~—~~ | ~~Texas~~ | api.drivetexas.org | `TXDOT_API_KEY` | ✅ **DONE 2026-11-10** — live statewide, ~1,800 events |

## 🧊 Travel-IQ family — road CONDITIONS (winter ice/snow layer)

Same API shape across ~10 states; one adapter + per-state key unlocks each.
This is the "winter road conditions" data class — separate from WZDx.
Priority order for Bill's routes:

| # | State | Portal |
|---|-------|--------|
| 14 | **Georgia** | 511ga.org → developer key (also gives incidents/closures) |
| 15 | **Utah** | UDOT 511 / Travel-IQ registration |
| 16 | **New York** | 511ny — Travel-IQ (our WZDx feed returns a web shell; this may fix NY entirely) |
| 17 | **Wisconsin** | 511wi — Travel-IQ (WZDx already live; this adds conditions/cameras) |
| 18 | **Louisiana** | 511la — Travel-IQ |
| 19 | **Idaho** | 511id — Travel-IQ |
| 20 | **Alaska** | 511.alaska.gov — Travel-IQ |
| 21 | **Arizona** | AZ511 — upgrades Maricopa-only to statewide |
| 22 | **Connecticut** | ctroads.org — ⚠️ verify license allows commercial use first |

## 🆓 ZERO signup — I build adapters (code only, no keys)

Verified or audit-confirmed keyless feeds — these need my time, not yours:

| State | Source | Status |
|-------|--------|--------|
| **Illinois** | IDOT winter road conditions ArcGIS | ✅ verified live — 410 segments, plow-reported |
| **Iowa** | 511 ArcGIS REST winter conditions | ✅ adapter LIVE 2026-11-11 — keyless, iowadot.gov-documented; non-Seasonal only (all Seasonal at deploy) |
| **Missouri** | ~~Keyless JSON feeds~~ | ✅ **adapter LIVE 2026-11-14** — MoDOT TravelerInformation ArcGIS layer 26 "Winter Road Conditions" (keyless, non-CLEAR only). Bonus found: layer 17 "Winter Weather Closed Line" has named routes — adapter queued for winter-code validation |
| **Maryland** | ~~CHART keyless JSON~~ | ✅ **adapter LIVE 2026-11-14** — CHARTExportClientService incidents + closures endpoints (keyless); winter/ice/snow incidentTypes only. Commercial terms still worth a sanity check |
| **Florida** | FDOT DIVAS keyless | 4,900 cameras + events already documented |

## ⛔ Blocked — do NOT spend time

AR (ToU bans third-party apps), ND (non-commercial w/o written consent),
TX-statewide-mirror (non-commercial), SC/WV/NM/RI/WY (no usable public feed),
CT pending license check.

## Suggested nightly order

- **Night 1 (tonight):** Castle Rock forms (MN/KS/NE/IN) + NPS + Michigan — slow ones first
- **Nights 2–5:** Virginia, California, NC, Colorado, MA, PA Turnpike, IL Tollway (one per night is plenty); Oregon paused
- **Nights 6–10:** Travel-IQ states in route-priority order (GA → UT → NY → WI → LA → ID → AK → AZ)
- **Parallel (me):** ~~IL winter adapter~~ → ~~IA~~ → MO → MD condition feeds
- **Dec 1–3 buffer:** stragglers + verification sweep

Source audits: `docs/DOT_FEED_COVERAGE.md` (WZDx tiers) +
github.com/nicglazkov/commutescout `state-expansion-audit.md` (all-50-state
API survey, verified live July 2026).
