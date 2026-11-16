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
warnings (nationwide, already painted) + **IL winter ArcGIS feed — adapter
LIVE 2026-11-11** (`kind: "condition"` → winter category; only non-Clear
plow-crew segments emit, so it lights up during storms) + **IA winter
ArcGIS feed — adapter LIVE 2026-11-11** (same pattern on Iowa DOT's public
ArcGIS org; Seasonal is the baseline so only Partially/Completely Covered,
Travel Not Advised, and Impassable segments emit; carries the CARS
"Reported" timestamp). Per-state
condition feeds exist for roughly half the states — see DOT_SIGNUPS.md
Travel-IQ + keyless sections. **UT forecast driving conditions live
2026-11-15** (`utconditions` — IBI DrivingConditions, keyless; see IBI
family note) **+ NE Compass RWIS live 2026-11-15** (`necompass-rwis` —
keyless C2C XML road-surface sensors for ME/NH/VT; Wet/Ice/Snow stations
emit with pavement temps) **+ Midwest winter aggregator live 2026-11-16**
(`midwestwinter` — IowaDOT_SODA "Winter Road Conditions - Midwest Region"
FeatureServer, keyless; plow-crew reports from eight state DOTs aggregated
into one layer with line geometry + route names; server-side LIKE filter +
48h freshness check; emits only for NE/KS/MN/ND/SD/WI — the six states
without their own winter feed, so IL/MO dupes are excluded at the
normalizer).

---

## ✅ LIVE (30 states/jurisdictions, ~40 feed sources)

| State | Feed(s) | Coverage note |
|---|---|---|
| Illinois | `idot_cwz` + **IL winter conditions** | CWZ work zones + plow-crew road conditions (ice/snow coverage, non-Clear only). Tollway still dark (KEYED). |
| Iowa | `idot` + **IA winter conditions** | Statewide open WZDx + plow-crew road conditions (non-Seasonal only). |
| Missouri | `modot` + `stcharlesco_v4` + **MO winter conditions** | Statewide + St. Charles County + MoDOT winter road-condition segments (non-Clear only; anonymous geometry, no road names). Winter Weather Closed Line layer (named routes) queued. |
| Maryland | `mdot` + **MD winter conditions** | Statewide WZDx + CHART winter/ice/snow incident & closure reports (keyless JSON export). |
| Ohio | `ohio` | OHGO — keyed, live. |
| Texas | `austin` + `txdot_v4_2` | **Statewide live** — DriveTexas key landed 2026-11-10 (~1,800 events). Austin city feed also flows. Road codes decoded (`IH0030`→`I-30`, `BU0059G`→`Business US-59 G`). |
| **Utah** | `ibi-ut` + `utconditions` | **NEW 2026-11-15** — UDOT 511 (IBI platform, keyless): ~88 events — construction, incidents, closures w/ lane + detour text. **Plus `utconditions`: forecast driving conditions** — named route segments × eight 3-hour windows to 24h (Condition + reason, WKT line geometry); only non-Green windows emit as `kind:"condition"`. First forecast-condition feed — first live capture: patchy ice on SR-190/SR-210 canyons. First UT coverage. **Plus `ibi-ut-rwis`** — 251-station WeatherStations feed (surface temp/precip/f friction); emits only freezing/wintry stations. |
| **Wisconsin** | `wisdot` + `ibi-wi` | Statewide WZDx construction **+ IBI closures/incidents** — the 511 Closures list carries ~100 real full-closure events (ramp/mainline/local-road w/ detours) that WZDx doesn't publish. IBI Construction skipped (same work zones mirrored). |
| **Alaska** | `ibi-ak` | **NEW 2026-11-15** — 511.alaska.gov (IBI, keyless): ~141 events — construction, incidents, closures. **Plus `ibi-ak-rwis`** — WeatherStations has no surface temp on AK, so it emits on freezing air temp / wintry precip only. First AK coverage. |
| **Georgia** | `ibi-ga` | **NEW 2026-11-15** — 511ga (IBI, keyless): ~99 events — construction, incidents, closures. Completes I-75/I-85 south corridor. No key needed after all. |
| Arizona | `mcdot` + `ibi-az` | Maricopa County WZDx (Phoenix metro) **+ ADOT 511 statewide** (IBI, keyless): ~178 events — construction, incidents, closures. Metro work zones may appear twice (different publishers, same state) — rural AZ is net-new. **Plus `ibi-az-rwis`** — WeatherStations feed emits only freezing pavement/air stations. |
| **Idaho** | `iddot` + `ibi-id` | Statewide WZDx construction + IBI incidents (thin — 1 event; ID has no Closures endpoint). IBI Construction skipped (mirrored). **Plus `ibi-id-rwis`** — WeatherStations feed emits only freezing/wintry stations (1 live at probe time). |
| **Nevada** | `ibi-nv` | **NEW 2026-11-15** — 511.nv.gov (IBI, keyless): ~83 events — construction, incidents, closures. **Plus `ibi-nv-rwis`** — WeatherStations feed (surface temp/precip; 46 of 192 stations carry surface sensors). First NV coverage. |
| Indiana | `indot` | Statewide. |
| Kansas | `kansas` | Statewide. |
| Kentucky | `kytc` | Statewide. |
| Minnesota | `mndot` | Statewide. |
| Mississippi | `msdot` | Statewide. |
| Louisiana | `ladotd` | Statewide (thin — 7 events right now). |
| New Jersey | `njdot` | Statewide. |
| Oklahoma | `odot` | Statewide. |
| Washington | `wsdot` | Statewide. |
| Hawaii | `hidot` | Statewide. |
| **California** | `caltrans-lcs-d1..12` + `caltrans-cc-d1,2,3,6..11` + `caltrans-rwis-d1,2,3,6,8,9,10` | **NEW 2026-11-15** — Caltrans CWWP2 (keyless): ~590 active/next-24h lane closures + chain controls (R-1…ESC/TH/TS) + freezing RWIS stations statewide. LCS filtered to active/24h to stay under KV limits. `mtc` 511 WZDx key still pending — adds nothing we don't already have. |
| **Oregon** | `ordot` + **OR winter conditions** | ODOT WZDx work zones (~146) **+ TripCheck road-weather reports** (`Rw/Reports` — chain-law restrictions A–D, icy/packed pavement, snow/fog; non-baseline only) **+ 229-station RWIS** (`v2/rwis` — only ≤freezing pavement/air emits). Same `ODOT_API_KEY`. |
| **Tennessee** | `tn-smartway-points` + `tn-smartway-lines` | **NEW 2026-11-15** — TDOT Smartway ArcGIS FeatureServer (keyless, not in WZDx registry): ~47 live events after window filtering — incidents, closures, construction w/ lane-impact prose decoded. Road names parsed from description text ("Interstate 40…" → I-40). |
| Delaware | `dedot` | Statewide (thin — 3 events). |
| North Dakota | `nddot` | Statewide. |
| South Dakota | `sddot` | Statewide. |
| New Hampshire + Vermont + Maine | `necdot` + `necompass-rwis` | One regional New England WZDx feed covers all three **+ NE Compass RWIS road-surface sensors** (keyless C2C XML — essData; non-Dry/non-Unknown stations emit as `kind:"condition"` with pavement temps). |
| Florida | `fdot` + `ibi-fl` | Partial WZDx **+ FL 511 incidents/closures** (IBI, keyless — Construction skipped as mirrored). |
| Canada (QC) | `quebec` | Provincial feed — bonus coverage, not a state. |

## 🔑 KEYED — plumbing ready, just needs the secret

All already in `KEYED_FEEDS` in `cloudflare/dot-feeds/src/index.ts`.
Set with `wrangler secret put <NAME>` then hit `/refresh`.

| Order | State | Feed name | Secret | Auth | Notes |
|---|---|---|---|---|---|
| ~~1~~ | ~~Texas (statewide)~~ | `txdot_v4_2` | `TXDOT_API_KEY` | `?key=` | ✅ **LIVE 2026-11-10** — ~1,842 events verified, codes decoded. |
| 2 | Illinois Tollway | `iltollway` | `ILTOLLWAY_API_KEY` | `?api_key=` | Toll roads only — IDOT CWZ doesn't cover them. Free registration at Timms/Tollway developer portal. |
| ~~3~~ | ~~Colorado~~ | `cdot` + `cdot_cwz` | `CDOT_API_KEY`, `CDOT_CWZ_API_KEY` | `?apiKey=` | ✅ **LIVE 2026-11-14** — one Cotrip key serves both feeds; ~313 CO events verified. |
| 4 | Michigan | `mdot_4` | `MDOT_API_KEY` | header `api_key` | **Not instant** — MiLogin for Business account → Discover Online Services → "MDOT RIDE". Info: michigan.gov/mdot ITS-data page. Verified endpoint wants `api_key` header (not Socrata token). |
| ~~5~~ | ~~Massachusetts~~ | `massdot__cwz` | `MASSDOT_CWZ_API_KEY` | header `Authorization: Bearer` | ✅ **LIVE 2026-11-15** — ~1,700 CWZ work zones. |
| ~~6~~ | ~~North Carolina~~ | `ncdot` | `NCDOT_API_KEY` | `?key=` query param | ✅ **LIVE 2026-11-15** — ~1,050 DriveNC work zones. |
| ~~7~~ | ~~Oregon~~ | `ordot` | `ODOT_API_KEY` | header `Ocp-Apim-Subscription-Key` | ✅ **LIVE 2026-11-15** — ~146 ODOT WZDx work zones + TripCheck winter conditions (see LIVE table). |
| ~~8~~ | ~~Virginia~~ | `vdot` | `VDOT_API_KEY` | `?token=` | ✅ **LIVE 2026-11-14** — ~3.1k events. The 10.6 MB feed that used to 1102 the Worker now parses fine in the snapshot Action (Node, no CPU cap). |
| 9 | California | `mtc` | `MTC_511_API_KEY` | `?api_key=` | api.511.org WZDx — despite feedname "mtc", state = California. **Low value now** — keyless Caltrans CWWP2 (LCS/CC/RWIS) already covers CA statewide; the 511 key would only add MTC Bay-Area incidents. |
| 10 | Pennsylvania | `ptc` | `PENNSTURNPIKE_API_KEY` | `?api_key=` | PA Turnpike only — toll roads. PA's regular DOT feed isn't in the registry. |
| ~~—~~ | ~~National (NPS)~~ | `nps` | `NPS_API_KEY` | `?api_key=` | ✅ **LIVE 2026-11-10** — park road events verified. |
| ~~—~~ | ~~Ohio~~ | `ohio` | `OHGO_API_KEY` | `?api-key=` | ✅ **LIVE** — key set 2026-11-14; OHGO registration portal. |
| ~~—~~ | ~~Illinois CWZ~~ | `idot_cwz` | `IDOT_CWZ_API_KEY` | `?api_key=` | ✅ **LIVE** — key set 2026-11-14; self-serve at wzad-idot.illinois.gov/cwz/api-key/ (307→transportal.cee.wisc.edu). Statewide IDOT work zones. |

### IBI/CARS 511 platform family (added 2026-11-15)

`prod-*.ibi511.com` hosts share one platform — public DataTables list feeds
(`/List/GetData/{Construction,Incidents,Closures}`) + bulk point geometry
(`/map/mapIcons/{layerName}`), **no API key**. One adapter in
`cloudflare/dot-feeds/src/index.ts` (`IBI_HOSTS`) covers every deployment;
adding a state = one config line after verifying its endpoints live.

Live hosts: UT, WI, AK, GA, AZ, ID, NV, FL. Gotchas found while probing:
`prod-ne` is the *Northeast* region (NH/VT/ME — already covered by
`necdot` WZDx, skipped), LA's hostname doesn't resolve, NY 503s (different
platform — 511ny.org needs its own survey), CT's feed is empty and
license-restricted. Hosts without a collection 500 on that endpoint —
treated as "collection missing," not an outage. WI/ID/FL skip the
Construction collection because their existing feeds already carry the
same work zones; their IBI Closures lists still add real full-closure
events WZDx lacks. Geometry is point-only (map icons) —
`/map/data/{layer}/{id}` has encoded polylines if line geometry is ever
wanted.

**WeatherStations RWIS (added 2026-11-15):** `List/GetData/WeatherStations`
+ `/map/mapIcons/WeatherStations` exist on **UT, NV, ID, AZ, AK** —
pavement surface temp (°F), air temp, precip, friction per station,
joined by `DT_RowId`. Wired as `ibi-{tag}-rwis` feeds: emit only
surface ≤33°F, air ≤15°F (sensor-less hosts like AK), or wintry precip —
dry stations stay silent. UT/NV/ID/AZ carry `surfaceTemperature`;
AK emits on air temp/precip only. Probed and rejected: WI/GA/FL have
no WeatherStations collection; `RoadConditions` exists on UT/NV but is
geometry-less named segments (no coords) — skipped.

**Condition endpoints (probed 2026-11-15):** `/List/GetData/DrivingConditions`
+ `/List/RoadConditions` exist only on **UT** (forecast: 8× 3-hour windows
per named segment, WKT geometry via `/map/data/`) and **NV** (RoadConditions,
different schema — unverified). All other hosts 500. UT's is wired as the
`utconditions` feed; NV's is a follow-up candidate.

## 🛠 CUSTOM — non-WZDx, needs a per-state adapter

These states publish road-event data but not in WZDx format. Each needs a
normalizer written into the worker (map their schema → `DotEvent`). Source
catalog: the "TARDIS 511" community project maps every state's feed type.

| Order | State | Feed type | Effort | Notes |
|---|---|---|---|---|
| ~~1~~ | ~~**Georgia**~~ | ~~511GA developer REST API~~ | — | ✅ **LIVE 2026-11-15 via `ibi-ga`** — the IBI adapter covered GA keyless before the 511GA key was ever needed. |
| ~~2~~ | ~~**Utah**~~ | ~~UDOT on IBI 511 platform~~ | — | ✅ **LIVE 2026-11-15 via `ibi-ut`** — the IBI adapter generalized exactly as predicted; 6 more IBI states came along (WI/AK/GA/AZ/ID/NV). |
| 3 | Indiana/Iowa/etc. deep-dives | Castle Rock / CARS XML | Medium | Already have WZDx for these states — only if we want incident data beyond work zones. |
| 4 | Remaining TARDIS states (AL, RI, WV, WY, etc.) | Mixed: Google-fed, ArcGIS, XML | Medium–Large each | Needs a per-state survey pass — formats vary wildly, several have "free key, no license" gray-area terms. NV came online via IBI 2026-11-15. |

## ⛔ BLOCKED / PROBABLY NOT

| State | Why |
|---|---|
| Connecticut | CTroads license **forbids commercial use**. CARS events are public-domain — partial coverage possible via that feed only; verify before building. |
| Arkansas | Data license **bans advertising** with it — conflicts with the ad-supported Basic tier. Would need Plus-only gating or a license conversation. |
| ~~Alaska~~ | ✅ **LIVE 2026-11-15 via `ibi-ak`** — the IBI 511 platform had a proper JSON API after all; the "barely digital" assessment was wrong. |
| New York | `nysdot` registry feed returns a JS app shell, not data — endpoint moved or never was a feed. Needs investigation; NY has a real 511 system so data exists somewhere. `prod-ny.ibi511.com` 503s — NY's 511 (511ny.org) is a different platform, needs its own survey. |
| States with no feed at all | AL, AR, CT, RI, WV, WY — GA/AK/NV/UT came online via the IBI adapter 2026-11-15. The rest need the per-state survey to confirm what exists. |

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
