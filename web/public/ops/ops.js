const SECRET_KEY = "stormpath.ops.secret";
      const FREE = {
        directions: 100_000,
        geocoding: 100_000,
        matching: 100_000,
        navTrips: 1_000,
        searchBox: 100_000,
        mapLoads: 50_000,
      };
      const LOCAL_DAYS_KEY = "stormpath.mapboxUsage.localDays.v1";
      const JEFF_LOCAL_LOG_KEY = "stormpath.jeff.localLog.v1";

      const gate = document.getElementById("gate");
      const app = document.getElementById("app");
      const secretInput = document.getElementById("secretInput");
      const lockBtn = document.getElementById("lockBtn");

      function todayUTC() {
        return new Date().toISOString().slice(0, 10);
      }

      function meterCardHtml(label, used, free) {
        const u = Number(used) || 0;
        const f = Number(free) || 1;
        const pct = Math.min(999, Math.round((u / f) * 100));
        const cls = pct >= 90 ? "bad" : pct >= 70 ? "warn" : "";
        const remain = Math.max(0, f - u);
        return `<div class="meter ${cls}">
          <div class="meter__label">${label}</div>
          <div class="meter__value">${u.toLocaleString()}</div>
          <div class="meter__meta">${pct}% of ${f.toLocaleString()} free</div>
          <div class="meter__remain">${remain.toLocaleString()} left this month</div>
          <div class="bar ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div>
        </div>`;
      }

      function readLocalAppMeterMonth() {
        try {
          const raw = localStorage.getItem(LOCAL_DAYS_KEY);
          const all = raw ? JSON.parse(raw) : {};
          const prefix = todayUTC().slice(0, 7);
          const totals = {
            directions: 0,
            geocoding: 0,
            matching: 0,
            navTrips: 0,
            searchBox: 0,
            mapLoads: 0,
          };
          if (!all || typeof all !== "object") return totals;
          for (const [date, c] of Object.entries(all)) {
            if (!String(date).startsWith(prefix) || !c) continue;
            for (const k of Object.keys(totals)) {
              totals[k] += Number(c[k]) || 0;
            }
          }
          return totals;
        } catch {
          return {
            directions: 0,
            geocoding: 0,
            matching: 0,
            navTrips: 0,
            searchBox: 0,
            mapLoads: 0,
          };
        }
      }

      const JEFF_DOMAIN_LABEL = {
        drive_camera: "Drive camera",
        live_traffic: "Live traffic",
      };

      function readLocalJeffLog() {
        try {
          const raw = localStorage.getItem(JEFF_LOCAL_LOG_KEY);
          const list = raw ? JSON.parse(raw) : [];
          return Array.isArray(list) ? list : [];
        } catch {
          return [];
        }
      }

      function jeffCountsFromEvents(events) {
        const c = { drive_camera: 0, live_traffic: 0, manual: 0, total: 0 };
        for (const e of events) {
          if (e.domain === "drive_camera" || e.domain === "live_traffic") c[e.domain] += 1;
          if (e.manual) c.manual += 1;
          c.total += 1;
        }
        return c;
      }

      function jeffCountsCardHtml(label, counts) {
        return `<div class="stat">
          <div class="v">${(counts?.total ?? 0).toLocaleString()}</div>
          <div class="l">${label}${
          counts?.manual ? ` · ${counts.manual} manual` : ""
        }</div>
        </div>`;
      }

      function renderJeffFixes(jeffFixes, isLive) {
        const grid = document.getElementById("jeffCountsGrid");
        const rows = document.getElementById("jeffRecentRows");
        const note = document.getElementById("jeffNote");
        let recent = jeffFixes?.recent;
        let countsToday = jeffFixes?.countsToday;
        let counts7d = jeffFixes?.counts7d;
        let countsMonth = jeffFixes?.countsMonth;

        if (!recent) {
          // Same-device fallback: this browser's own local Jeff log (no server aggregate).
          const local = readLocalJeffLog()
            .slice()
            .sort((a, b) => b.atMs - a.atMs);
          recent = local;
          const now = Date.now();
          const todayStartMs = new Date(todayUTC() + "T00:00:00.000Z").getTime();
          const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;
          const monthStartMs = new Date(todayUTC().slice(0, 7) + "-01T00:00:00.000Z").getTime();
          countsToday = jeffCountsFromEvents(local.filter((e) => e.atMs >= todayStartMs));
          counts7d = jeffCountsFromEvents(local.filter((e) => e.atMs >= sevenDaysAgoMs));
          countsMonth = jeffCountsFromEvents(local.filter((e) => e.atMs >= monthStartMs));
        }

        grid.innerHTML =
          jeffCountsCardHtml("Fixed today", countsToday) +
          jeffCountsCardHtml("Fixed last 7 days", counts7d) +
          jeffCountsCardHtml("Fixed this month", countsMonth);

        rows.innerHTML = recent.length
          ? recent
              .slice(0, 40)
              .map(
                (e) => `<tr>
                <td>${new Date(e.atMs).toLocaleString()}</td>
                <td>${JEFF_DOMAIN_LABEL[e.domain] || e.domain}</td>
                <td>${e.manual ? "Manual tap" : "Auto watchdog"}</td>
                <td class="faint">${e.note || ""}</td>
              </tr>`
              )
              .join("")
          : `<tr><td colspan="4" class="faint">Nothing fixed yet — that's a good sign.</td></tr>`;

        note.textContent = isLive
          ? jeffFixes?.note || ""
          : "Showing this device's local log only (no live summary) — unlock with the Netlify/home-api secret to see every device.";
      }

      function bytesToGb(n) {
        return (Number(n) || 0) / 1024 ** 3;
      }

      function renderNetlifyUsage(nl, opts) {
        const barsEl = document.getElementById("nlUsageBars");
        const metaEl = document.getElementById("nlUsageMeta");
        const noteEl = document.getElementById("nlUsageNote");
        if (!barsEl || !noteEl) return;
        noteEl.classList.remove("warn", "bad");
        const hasLiveSummary = Boolean(opts && opts.hasLiveSummary);
        const deployConfigured = Boolean(opts && opts.deployConfigured);

        if (!nl) {
          barsEl.innerHTML = "";
          metaEl.textContent = "";
          noteEl.classList.add("warn");
          noteEl.textContent = hasLiveSummary
            ? "Live summary came back without Netlify usage \u2014 wait for the latest deploy to finish, then refresh."
            : "Unlock with OPS_HUB_SECRET on the live stormpath2 site to load Netlify usage. Local-only mode cannot read these account numbers.";
          return;
        }
        if (!nl.configured) {
          barsEl.innerHTML = "";
          metaEl.textContent = "";
          noteEl.classList.add("warn");
          const missing = Array.isArray(nl.missing) ? nl.missing.join(" + ") : "NETLIFY_AUTH_TOKEN";
          noteEl.innerHTML =
            `Cannot see <code>${missing}</code> from the running function.<br>` +
            `Most common cause: the variable exists but its <strong>scope is Builds only</strong>. ` +
            `In Netlify \u2192 stormpath2 \u2192 Environment variables, open <code>NETLIFY_AUTH_TOKEN</code>, ` +
            `include <strong>Functions</strong> in the scopes (All scopes is fine), save, then ` +
            `<strong>Trigger deploy</strong>. Site ID is optional now \u2014 Netlify already provides it automatically.`;
          return;
        }
        if (nl.error && !nl.bandwidth && !nl.builds) {
          barsEl.innerHTML = "";
          metaEl.textContent = "";
          noteEl.classList.add("warn");
          noteEl.textContent = `Netlify usage unavailable (${nl.error}). Check app.netlify.com \u2192 Billing \u2192 Usage directly if this stays empty.`;
          return;
        }

        const cards = [];
        let worst = 0;
        if (nl.bandwidth) {
          const usedGb = bytesToGb(nl.bandwidth.usedBytes);
          const includedGb = bytesToGb(nl.bandwidth.includedBytes);
          cards.push(meterCardHtml("Bandwidth (GB)", usedGb, includedGb || 1));
          if (includedGb > 0) worst = Math.max(worst, (usedGb / includedGb) * 100);
        }
        if (nl.builds) {
          cards.push(
            meterCardHtml("Build minutes", nl.builds.minutesUsed, nl.builds.minutesIncluded || 1)
          );
          if (nl.builds.minutesIncluded > 0) {
            worst = Math.max(
              worst,
              (nl.builds.minutesUsed / nl.builds.minutesIncluded) * 100
            );
          }
        }
        barsEl.innerHTML = cards.join("");

        const periodStart = nl.builds?.periodStart || nl.bandwidth?.periodStart;
        const periodEnd = nl.builds?.periodEnd || nl.bandwidth?.periodEnd;
        const fmt = (iso) => {
          if (!iso) return null;
          const d = new Date(iso);
          return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
        };
        const startLabel = fmt(periodStart);
        const endLabel = fmt(periodEnd);
        metaEl.textContent = startLabel
          ? `${startLabel} \u2013 ${endLabel || "?"}`
          : "";

        if (worst >= 90) {
          noteEl.classList.add("bad");
          noteEl.textContent = "\u226590% of a Netlify limit used this billing period.";
        } else if (worst >= 70) {
          noteEl.classList.add("warn");
          noteEl.textContent = "\u226570% of a Netlify limit used this billing period.";
        } else {
          noteEl.textContent =
            "From Netlify's own account API \u2014 real numbers, not counted by StormPath.";
        }
      }

      const BASELINE_FIELD_IDS = {
        mapLoads: "mbBaseMapLoads",
        directions: "mbBaseDir",
        geocoding: "mbBaseGeo",
        matching: "mbBaseMatch",
        navTrips: "mbBaseNav",
        searchBox: "mbBaseSearch",
      };

      function fillBaselineForm(summary) {
        const summaryEl = document.getElementById("mbBaselineSummary");
        const baseline = summary?.baseline;
        for (const [key, id] of Object.entries(BASELINE_FIELD_IDS)) {
          const el = document.getElementById(id);
          if (!el) continue;
          const v = baseline?.[key];
          if (v) el.value = String(v);
        }
        if (summaryEl) {
          summaryEl.textContent = summary?.baselineSetAt
            ? `Starting point set ${new Date(summary.baselineSetAt).toLocaleString()} — edit or correct it`
            : "Set a starting point (one-time catch-up)";
        }
      }

      function renderLiveUsage(summary) {
        const liveEl = document.getElementById("mbLiveBars");
        const metaEl = document.getElementById("mbLiveMeta");
        const noteEl = document.getElementById("mbLiveNote");
        const local = readLocalAppMeterMonth();
        const totals = summary?.totals || local;
        const free = summary?.freeTier || FREE;
        fillBaselineForm(summary);
        const labels = summary?.labels || {
          directions: "Directions",
          geocoding: "Temporary geocoding",
          matching: "Map Matching",
          navTrips: "Navigation trips",
          searchBox: "Search Box",
          mapLoads: "Map loads (Web)",
        };
        const hasAny = Object.values(totals).some((n) => n > 0);
        metaEl.textContent = summary ? `${summary.month} · app reports` : "This device only";

        liveEl.innerHTML = [
          meterCardHtml(labels.mapLoads || "Map loads", totals.mapLoads, free.mapLoads || FREE.mapLoads),
          meterCardHtml(labels.directions || "Directions", totals.directions, free.directions),
          meterCardHtml(labels.geocoding || "Geocoding", totals.geocoding, free.geocoding),
          meterCardHtml(labels.matching || "Matching", totals.matching, free.matching),
          meterCardHtml(labels.navTrips || "Nav trips", totals.navTrips, free.navTrips),
          meterCardHtml(
            labels.searchBox || "Search Box",
            totals.searchBox,
            free.searchBox || FREE.searchBox
          ),
        ].join("");

        const worst = Object.keys(free).reduce((w, k) => {
          const pct = free[k] > 0 ? ((totals[k] || 0) / free[k]) * 100 : 0;
          return Math.max(w, pct);
        }, 0);
        if (noteEl) {
          noteEl.classList.remove("warn", "bad");
          if (!hasAny) {
            noteEl.classList.add("warn");
            noteEl.textContent =
              "No Mapbox usage reported yet. Auto app metering needs OPS_USAGE_INGEST_TOKEN on Netlify AND the matching VITE_OPS_USAGE_INGEST_TOKEN as a GitHub Actions repo secret, then a fresh TestFlight/App Store build — Netlify env vars alone don't reach the phone app. Customers never see any of this.";
          } else if (worst >= 90) {
            noteEl.classList.add("bad");
            noteEl.textContent = "≥90% of a free tier used this month.";
          } else if (worst >= 70) {
            noteEl.classList.add("warn");
            noteEl.textContent = "≥70% of a free tier used this month.";
          } else {
            noteEl.textContent =
              "Month-to-date vs Mapbox free tiers, counted directly by the app (Mapbox has no usage API of its own).";
          }
        }
      }

      function pill(ok, label, detail) {
        const cls = ok === true ? "ok" : ok === false ? "bad" : "warn";
        const title = detail ? ` title="${detail.replace(/"/g, "&quot;")}"` : "";
        return `<span class="pill"${title}><span class="dot ${cls}"></span>${label}</span>`;
      }

      function stat(v, l) {
        return `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
      }

      async function localHealth() {
        const origin = location.origin;
        const checks = [
          ["web", "App", `${origin}/`],
          ["nws", "NWS proxy", `${origin}/weather-gov/alerts/active?status=actual`],
          ["rv", "RainViewer", `${origin}/rainviewer-api/public/weather-maps.json`],
        ];
        const results = await Promise.all(
          checks.map(async ([id, label, url]) => {
            const t0 = performance.now();
            try {
              const res = await fetch(url, { cache: "no-store" });
              return {
                id,
                label,
                ok: res.ok,
                ms: Math.round(performance.now() - t0),
                detail: res.ok ? undefined : `HTTP ${res.status}`,
              };
            } catch (e) {
              return {
                id,
                label,
                ok: false,
                ms: Math.round(performance.now() - t0),
                detail: e instanceof Error ? e.message : "failed",
              };
            }
          })
        );
        return results;
      }

      async function fetchSummary(secret) {
        if (!secret) return null;
        // Netlify: /.netlify/functions/ops-summary. Forge home-api: /ops-summary.
        // Prefer the Netlify path on this host so a 404 HTML SPA page never
        // gets mistaken for JSON ("Unexpected token '<'").
        const onNetlify =
          /\.netlify\.app$/i.test(location.hostname) ||
          location.hostname === "stormpath2.netlify.app";
        const candidates = onNetlify
          ? ["/.netlify/functions/ops-summary", "/ops-summary"]
          : ["/ops-summary", "/.netlify/functions/ops-summary"];
        let lastErr = "ops-summary failed";
        for (const path of candidates) {
          try {
            const res = await fetch(path, {
              headers: { Authorization: `Bearer ${secret}` },
              cache: "no-store",
            });
            const text = await res.text();
            let body = {};
            try {
              body = text ? JSON.parse(text) : {};
            } catch {
              // HTML/SPA fallback — try next candidate.
              lastErr = `ops-summary non-JSON at ${path} (HTTP ${res.status})`;
              if (res.status === 404 || !res.ok) continue;
              throw new Error(lastErr);
            }
            if (res.ok) return body;
            lastErr = body.error || `ops-summary HTTP ${res.status}`;
            // 404 = wrong host layout; try next. Auth/config errors stop here.
            if (res.status !== 404) throw new Error(lastErr);
          } catch (e) {
            if (e instanceof TypeError) {
              lastErr = e.message;
              continue;
            }
            throw e;
          }
        }
        throw new Error(lastErr);
      }

      async function renderApp(secret) {
        gate.classList.add("hidden");
        app.classList.add("show");
        lockBtn.hidden = false;
        renderLiveUsage(null);

        let summary = null;
        let summaryError = null;
        if (secret) {
          try {
            summary = await fetchSummary(secret);
          } catch (e) {
            summaryError = e instanceof Error ? e.message : "summary failed";
          }
        }

        renderLiveUsage(summary?.mapboxUsage || null);
        window.__opsLastMapboxSummary = summary?.mapboxUsage || null;

        renderNetlifyUsage(summary?.netlifyUsage || null, {
          hasLiveSummary: Boolean(summary),
          deployConfigured: Boolean(summary?.deploy?.configured),
        });

        renderJeffFixes(summary?.jeffFixes || null, Boolean(summary?.jeffFixes));

        const health = summary?.health?.length
          ? summary.health
          : await localHealth();

        document.getElementById("healthRow").innerHTML = health
          .map((h) =>
            pill(
              h.ok,
              `${h.label}${h.ms != null ? ` ${h.ms}ms` : ""}`,
              h.detail || (h.status != null ? `HTTP ${h.status}` : "")
            )
          )
          .join("");

        document.getElementById("generatedAt").textContent = summary
          ? `Live summary ${new Date(summary.generatedAt).toLocaleString()}`
            : summaryError
              ? `Live summary unavailable (${summaryError}). Showing local health + this device's Mapbox counts.`
              : "Local mode — health from this origin; income needs Netlify secrets.";

        const incomeGrid = document.getElementById("incomeGrid");
        const incomeNote = document.getElementById("incomeNote");
        if (summary?.income?.configured && summary.income.metrics?.length) {
          incomeGrid.innerHTML = summary.income.metrics
            .map((m) => {
              const val =
                typeof m.value === "number"
                  ? m.unit === "$"
                    ? `$${m.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : m.value.toLocaleString()
                  : m.value ?? "—";
              return stat(val, m.name);
            })
            .join("");
          incomeNote.textContent = "RevenueCat overview (StormPath project).";
        } else {
          incomeGrid.innerHTML = stat("—", "Plus / MRR");
          incomeNote.textContent = summary?.income?.error
            ? summary.income.error
            : "Add REVENUECAT_SECRET_API_KEY + REVENUECAT_PROJECT_ID on Netlify to show income here.";
        }

        const ship = [];
        if (summary?.deploy?.configured) {
          ship.push(
            stat(
              summary.deploy.error
                ? "err"
                : summary.deploy.state || "—",
              `Netlify deploy ${summary.deploy.commitRef || ""}`.trim()
            )
          );
        } else {
          ship.push(stat("—", "Netlify deploy"));
        }
        if (summary?.ios) {
          const label = summary.ios.error
            ? "err"
            : summary.ios.conclusion || summary.ios.status || "—";
          ship.push(
            stat(
              label,
              summary.ios.htmlUrl
                ? `<a href="${summary.ios.htmlUrl}" target="_blank" rel="noreferrer">iOS build ${summary.ios.headSha || ""}</a>`
                : "iOS build"
            )
          );
        } else {
          ship.push(stat("—", "iOS build"));
        }
        if (summary?.sentry?.configured) {
          ship.push(
            stat(
              summary.sentry.error ? "err" : String(summary.sentry.count ?? "—"),
              "Sentry open issues (14d)"
            )
          );
        } else {
          ship.push(stat("—", "Sentry open issues"));
        }
        document.getElementById("shipGrid").innerHTML = ship.join("");
        /* Allow HTML in ship labels */
        document.querySelectorAll("#shipGrid .l").forEach((el) => {
          if (el.textContent.includes("<a ")) {
            /* already escaped wrongly — rebuild from summary */
          }
        });
        if (summary?.ios?.htmlUrl) {
          const cells = document.querySelectorAll("#shipGrid .stat");
          if (cells[1]) {
            cells[1].querySelector(".l").innerHTML =
              `<a href="${summary.ios.htmlUrl}" target="_blank" rel="noreferrer">iOS build ${summary.ios.headSha || ""}</a>`;
          }
        }
      }

      function unlock(secret) {
        if (secret) sessionStorage.setItem(SECRET_KEY, secret);
        else sessionStorage.removeItem(SECRET_KEY);
        return renderApp(secret || "");
      }

      document
        .getElementById("unlockBtn")
        .addEventListener("click", async () => {
          const secret = secretInput.value.trim();
          const gateError = document.getElementById("gateError");
          const btn = document.getElementById("unlockBtn");
          if (!secret) {
            unlock("");
            return;
          }
          gateError.style.display = "none";
          btn.disabled = true;
          btn.textContent = "Checking\u2026";
          try {
            // Verify BEFORE unlocking — a wrong secret must never show the app.
            await fetchSummary(secret);
            unlock(secret);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/unauthorized/i.test(msg)) {
              gateError.textContent =
                "Wrong secret. Re-copy the exact OPS_HUB_SECRET value from Netlify and try again.";
              gateError.style.display = "block";
            } else {
              // Can't verify at all (e.g. local dev with no serverless
              // functions running) — that's not a bad password, so let
              // the user in to the local-only view instead of blocking them.
              unlock(secret);
            }
          } finally {
            btn.disabled = false;
            btn.textContent = "Open Control Room";
          }
        });
      document.getElementById("localOnlyBtn").addEventListener("click", () => {
        unlock("");
      });
      lockBtn.addEventListener("click", () => {
        sessionStorage.removeItem(SECRET_KEY);
        app.classList.remove("show");
        gate.classList.remove("hidden");
        lockBtn.hidden = true;
      });

      function opsUsagePostEndpoints() {
        const onNetlify =
          /\.netlify\.app$/i.test(location.hostname) ||
          location.hostname === "stormpath2.netlify.app";
        return onNetlify
          ? ["/.netlify/functions/ops-usage", "/ops-usage"]
          : ["/ops-usage", "/.netlify/functions/ops-usage"];
      }

      document.getElementById("mbBaseSave").addEventListener("click", async () => {
        const statusEl = document.getElementById("mbBaseStatus");
        const btn = document.getElementById("mbBaseSave");
        const secret = sessionStorage.getItem(SECRET_KEY) || "";
        if (!secret) {
          statusEl.textContent = "Unlock the Control Room with OPS_HUB_SECRET first.";
          return;
        }
        const baseline = {};
        for (const [key, id] of Object.entries(BASELINE_FIELD_IDS)) {
          const el = document.getElementById(id);
          baseline[key] = Number(el?.value || 0);
        }
        btn.disabled = true;
        statusEl.textContent = "Saving\u2026";
        let ok = false;
        let lastErr = "Save failed";
        for (const path of opsUsagePostEndpoints()) {
          try {
            const res = await fetch(path, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${secret}`,
              },
              body: JSON.stringify({ baseline }),
              cache: "no-store",
            });
            if (res.ok) {
              ok = true;
              break;
            }
            if (res.status !== 404) {
              const body = await res.json().catch(() => ({}));
              lastErr = body.error || `HTTP ${res.status}`;
              break;
            }
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
          }
        }
        btn.disabled = false;
        if (!ok) {
          statusEl.textContent = lastErr;
          return;
        }
        statusEl.textContent = "Saved.";
        try {
          const summary = await fetchSummary(secret);
          renderLiveUsage(summary?.mapboxUsage || null);
          window.__opsLastMapboxSummary = summary?.mapboxUsage || null;
        } catch {
          /* saved fine — a re-fetch failure here just means the page needs a manual reload */
        }
      });

      const existing = sessionStorage.getItem(SECRET_KEY);
      if (existing != null) {
        secretInput.value = existing;
        unlock(existing);
      }
