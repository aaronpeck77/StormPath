# DOT / WZDx feed coverage — state by state

Living tracker for `cloudflare/dot-feeds`. Verified against the live worker
(`/events`) and the USDOT WZDx registry on 2026-11-11.

Worker: `https://stormpath-dot-feeds.psvkzbbmnt.workers.dev`
Registry: `data.transportation.gov/resource/69qe-yiui` (42 active rows)

Feed buckets:

- **LIVE** — events flowing into the app today.
- **KEYED** — WZDx/CWZ feed exists, worker plumbing ready, just needs the
  API-key secret set (`wrangler secret put`). Easiest tier — no code.
- **CUSTOM** — state runs its own 511 platform (not WZDx). Needs a per-state
  adapter written into the worker. See "Custom-adapter candidates" below.
- **BLOCKED** — license or technical wall; do not build without a decision.

> **Actionable signup sprint:** `docs/DOT_SIGNUPS.md` — nightly checklist for
> the Dec-4 credit deadline, incl. the Travel-IQ road-conditions family
> (winter ice/snow layer — a second data class beyond WZDx work zones) and
> keyless condition feeds needing zero signups (IL winter ArcGIS verified,
> IA/MO/MD/FL per the commutescout all-state audit).

Road *conditions* (ice, snow-covered, drifting — plow/RWIS reports) are a
separate data class from WZDx work zones. Coverage so far: NWS winter
warnings (nationwide, already painted) + IL winter ArcGIS feed (verified
keyless, adapter pending). Per-state condition feeds exist for roughly
half the states — see DOT_SIGNUPS.md Travel-IQ + keyless sections.

---

## ✅ LIVE (27 feeds producing events)

| State | Feed(s) | Coverage note |
|---|---|---|
| Illinois | `idot_cwz` | CWZ work zones — the good feed. Regular IL 511 feed not registered; Tollway still dark (KEYED). |
| Iowa | `idot` | Statewide open feed. |
| Ohio | `ohio` | OHGO — keyed, live. |
| Texas | `austin` | **Austin city feed only** — not statewide. `txdot_v4_2` (DriveTexas) is KEYED, awaiting Bill's approved key. |
| Arizona | `mcdot` | Maricopa County — Phoenix metro only, not statewide. |
| Missouri | `modot` + `stcharlesco_v4` | Statewide + St. Charles County local feed. |
| Wisconsin | `wisdot` | Statewide. |
| Indiana | `indot` | Statewide. |
| Kansas | `kansas` | Statewide. |
| Kentucky | `kytc` | Statewide. |
| Minnesota | `mndot` | Statewide. |
| Mississippi | `msdot` | Statewide. |
| Louisiana | `ladotd` | Statewide (thin — 7 events right now). |
| Maryland | `mdot` | Statewide. |
| New Jersey | `njdot` | Statewide. |
| Oklahoma | `odot` | Statewide. |
| Washington | `wsdot` | Statewide. |
| Idaho | `iddot` | Statewide. |
| Hawaii | `hidot` | Statewide. |
| Delaware | `dedot` | Statewide (thin — 3 events). |
| North Dakota | `nddot` | Statewide. |
| South Dakota | `sddot` | Statewide. |
| New Hampshire + Vermont + Maine | `necdot` | One regional New England feed covers all three. |
| Florida | `fdot` | Partial — see "Dead/empty" for the second FL feed. |
| Canada (QC) | `quebec` | Provincial feed — bonus coverage, not a state. |

## 🔑 KEYED — plumbing ready, just needs the secret

All already in `KEYED_FEEDS` in `cloudflare/dot-feeds/src/index.ts`.
Set with `wrangler secret put <NAME>` then hit `/refresh`.

| Order | State | Feed name | Secret | Auth | Notes |
|---|---|---|---|---|---|
| 1 | Texas (statewide) | `txdot_v4_2` | `TXDOT_API_KEY` | `?key=` | Bill applied — awaiting approval email. Replaces Austin-only coverage. |
| 2 | Illinois Tollway | `iltollway` | `ILTOLLWAY_API_KEY` | `?api_key=` | Toll roads only — IDOT CWZ doesn't cover them. Free registration at Timms/Tollway developer portal. |
| 3 | Colorado | `cdot` + `cdot_cwz` | `CDOT_API_KEY`, `CDOT_CWZ_API_KEY` | `?apiKey=` | Two feeds — Cotrip WZDx + CO CWZ. |
| 4 | Michigan | `mdot_4` | `MDOT_API_KEY` | header `X-App-Token` | Socrata app token — instant at data.mi.gov. |
| 5 | Massachusetts | `massdot__cwz` | `MASSDOT_CWZ_API_KEY` | header `Authorization: Bearer` | CWZ work zones. |
| 6 | North Carolina | `ncdot` | `NCDOT_API_KEY` | header `Authorization: Bearer` | DriveNC WZDx. |
| 7 | Oregon | `ordot` | `ODOT_API_KEY` | header `Ocp-Apim-Subscription-Key` | Azure APIM key. |
| 8 | Virginia | `vdot` | `VDOT_API_KEY` | `?token=` | 511-atis (Iteris). |
| 9 | California | `mtc` | `MTC_511_API_KEY` | `?api_key=` | api.511.org WZDx — despite feedname "mtc", state = California. |
| 10 | Pennsylvania | `ptc` | `PENNSTURNPIKE_API_KEY` | `?api_key=` | PA Turnpike only — toll roads. PA's regular DOT feed isn't in the registry. |
| — | National (NPS) | `nps` | `NPS_API_KEY` | `?api_key=` | National park road work zones — national, not a state. |

## 🛠 CUSTOM — non-WZDx, needs a per-state adapter

These states publish road-event data but not in WZDx format. Each needs a
normalizer written into the worker (map their schema → `DotEvent`). Source
catalog: the "TARDIS 511" community project maps every state's feed type.

| Order | State | Feed type | Effort | Notes |
|---|---|---|---|---|
| 1 | **Georgia** | 511GA developer REST API — clean JSON, free instant key | Small | `511ga.org/api/v2/get/event?key=&format=json` — roadwork/closures/incidents w/ lat-lng, lanes, severity, dates. Best effort-to-value on the list; completes I-75/I-85 south corridor. |
| 2 | **Utah** | UDOT on IBI 511 platform (`prod-ut.ibi511.com`) | Medium | Unofficial JSON endpoints (List/GetData) — scrapable, other projects already do it. Could generalize to other IBI states later. |
| 3 | Indiana/Iowa/etc. deep-dives | Castle Rock / CARS XML | Medium | Already have WZDx for these states — only if we want incident data beyond work zones. |
| 4 | Remaining TARDIS states (AL, NV, RI, WV, WY, etc.) | Mixed: Google-fed, ArcGIS, XML | Medium–Large each | Needs a per-state survey pass — formats vary wildly, several have "free key, no license" gray-area terms. |

## ⛔ BLOCKED / PROBABLY NOT

| State | Why |
|---|---|
| Connecticut | CTroads license **forbids commercial use**. CARS events are public-domain — partial coverage possible via that feed only; verify before building. |
| Arkansas | Data license **bans advertising** with it — conflicts with the ad-supported Basic tier. Would need Plus-only gating or a license conversation. |
| Alaska | Barely digital — WMS / non-geospatial XML. Highest effort, lowest value (few roads, few users). |
| New York | `nysdot` registry feed returns a JS app shell, not data — endpoint moved or never was a feed. Needs investigation; NY has a real 511 system so data exists somewhere. |
| States with no feed at all | AL, AK, AR, GA*, NV, RI, UT*, WV, WY, CT — *GA/UT have non-WZDx feeds (CUSTOM tier). The rest need the per-state survey to confirm what exists. |

## Dead / empty registered feeds (open, produce zero)

- `nysdot` (NY) — returns HTML app shell, not GeoJSON.
- `fldot` (FL) — second FL feed returns ~1.7 MB but parses to zero events (shape mismatch or genuinely empty). `fdot` covers FL partially.
- `CivicLink_CrewCast` — community/Replit experiment, nothing flowing.

## Known nits

- Worker state labels are inconsistent (`Illinois` vs `illinois` vs
  `New Hampshire, Vermont, Maine`) — cosmetic, from feed-provided values.
- `quebec` events carry `state: "n/a"` — provincial feed has no state field.

## How to add a state

1. **Keyed WZDx/CWZ**: register for the key → `wrangler secret put <NAME>` in
   `cloudflare/dot-feeds` → `POST /refresh` → verify `/events` shows it.
2. **Custom**: write a fetcher in `cloudflare/dot-feeds/src/index.ts` that maps
   the state feed to `DotEvent` (see existing normalizers), add the row to the
   fetch loop, deploy, verify.
