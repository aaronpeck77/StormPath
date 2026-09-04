# StormPath gold standard (fallback snapshot)

**What this is:** A sealed Git commit Bill can fall back to when navigation is known-good. Not an App Store binary by itself — it is the **source** tip that built the good TestFlight/dev experience.

**Current gold**

| Field | Value |
|-------|--------|
| Moving pointer | branch `gold/current` |
| This archive tag | `gold/2026-09-04-nav-solid` |
| Commit | `29e3242` — *Block Drive from flying out to Canada-scale zoom.* |
| Why sealed | Phone soak Sep 4 2026: nav “as good as I could ask for”; small polish still OK later |

## What landed on the phone today (before this seal)

On `master` after last night’s graph commit (`8e88af3`):

1. **`7458177`** — Restore Drive follow-cam after Wi‑Fi → cell so the map does not freeze  
2. **`1b436d0`** — Stop follow-cam flipping between pan / hard setCenter / jumpTo  
3. **`138e4da`** — Stop puck leaping along the road when tiles flap  
4. **`29e3242`** — Block Drive from flying out to Canada-scale zoom  

Also still in this lineage: off-route replan (`0809ed1`), labeled Along-your-route graph (`8e88af3`).

**Still open:** driveway Wi‑Fi → cell soak (Bill to confirm). If that fails, fix on `master`, then promote a **new** gold when solid — do not rewrite this tag.

---

## Fall back to this gold (when you screw something up)

```bash
cd "C:\My Apps\StormPath - v3"
git fetch origin
git switch -C restore-from-gold origin/gold/current
# or exact archive:
# git switch -C restore-from-gold gold/2026-09-04-nav-solid
```

Then run web / cut TestFlight from that checkout as usual. To put `master` back on gold (destructive to later commits — only if Bill asks):

```bash
git fetch origin
git switch master
git reset --hard origin/gold/current
git push origin master   # only if Bill explicitly wants master rewound
```

Prefer a restore branch + PR/cherry-picks over hard-resetting `master` unless Bill says so.

---

## Promote a new gold (when the next version is better)

1. Confirm on a real drive (off-route, Go lock, Wi‑Fi→cell if possible).  
2. Note the good commit SHA on `origin/master`.  
3. Archive the previous gold tip with a **new dated tag** (never delete old tags):

```bash
git fetch origin
git tag -a gold/YYYY-MM-DD-short-reason <good-sha> -m "Gold: why this tip is better"
git branch -f gold/current <good-sha>
git push origin gold/YYYY-MM-DD-short-reason
git push origin gold/current --force-with-lease
```

4. Update the **Current gold** table at the top of this file and commit that doc change on `master`.

`--force-with-lease` on `gold/current` is OK — that branch is a **pointer**, not history. Dated `gold/…` tags stay forever as the archive stack.

---

## Agents

- Do **not** move `gold/current` or add gold tags unless Bill asks to seal/promote.  
- Prefer fixing bugs on `master`; seal only after Bill says the soak is good.  
- Local Forge experiments (uncommitted camera/Brain) are **not** gold until committed, pushed, and sealed.
