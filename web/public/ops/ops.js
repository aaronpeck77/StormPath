const SECRET_KEY = "stormpath.ops.secret";
      const LEDGER_KEY = "stormpath.ops.mapboxLedger";
      const FREE = {
        directions: 100_000,
        geocoding: 100_000,
        matching: 100_000,
        navTrips: 1_000,
        searchBox: 100_000,
      };
      const LOCAL_DAYS_KEY = "stormpath.mapboxUsage.localDays.v1";

      const gate = document.getElementById("gate");
      const app = document.getElementById("app");
      const secretInput = document.getElementById("secretInput");
      const lockBtn = document.getElementById("lockBtn");

      function todayUTC() {
        return new Date().toISOString().slice(0, 10);
      }

      function loadLedger() {
        try {
          const raw = localStorage.getItem(LEDGER_KEY);
          const list = raw ? JSON.parse(raw) : [];
          return Array.isArray(list) ? list : [];
        } catch {
          return [];
        }
      }

      function saveLedger(list) {
        localStorage.setItem(LEDGER_KEY, JSON.stringify(list.slice(0, 60)));
      }

      function monthTotal(list, field) {
        const prefix = todayUTC().slice(0, 7);
        return list
          .filter((r) => String(r.date).startsWith(prefix))
          .reduce((n, r) => n + (Number(r[field]) || 0), 0);
      }

      function barHtml(label, used, free) {
        const pct = Math.min(100, Math.round((used / free) * 100));
        const cls = pct >= 90 ? "bad" : pct >= 70 ? "warn" : "";
        return `<div>
          <div class="row" style="justify-content:space-between">
            <span>${label}</span>
            <span class="faint">${used.toLocaleString()} / ${free.toLocaleString()} (${pct}%)</span>
          </div>
          <div class="bar ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div>
        </div>`;
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
          };
        }
      }

      function renderLiveUsage(summary) {
        const liveEl = document.getElementById("mbLiveBars");
        const metaEl = document.getElementById("mbLiveMeta");
        const noteEl = document.getElementById("mbLiveNote");
        const reconcile = document.getElementById("mbReconcile");
        const local = readLocalAppMeterMonth();
        const pasted = {
          directions: monthTotal(loadLedger(), "directions"),
          geocoding: monthTotal(loadLedger(), "geocoding"),
          matching: monthTotal(loadLedger(), "matching"),
          navTrips: monthTotal(loadLedger(), "navTrips"),
          searchBox: 0,
        };
        const fromApp = summary?.totals || local;
        /* Show the higher of app-meter vs pasted dashboard numbers so paste works today. */
        const totals = {
          directions: Math.max(fromApp.directions || 0, pasted.directions || 0),
          geocoding: Math.max(fromApp.geocoding || 0, pasted.geocoding || 0),
          matching: Math.max(fromApp.matching || 0, pasted.matching || 0),
          navTrips: Math.max(fromApp.navTrips || 0, pasted.navTrips || 0),
          searchBox: fromApp.searchBox || 0,
        };
        const free = summary?.freeTier || FREE;
        const labels = summary?.labels || {
          directions: "Directions",
          geocoding: "Temporary geocoding",
          matching: "Map Matching",
          navTrips: "Navigation trips",
          searchBox: "Search Box",
        };
        const hasAny = Object.values(totals).some((n) => n > 0);
        const sourceBits = [];
        if (summary) sourceBits.push(`${summary.month} · app reports`);
        else sourceBits.push("This device");
        if (Object.values(pasted).some((n) => n > 0)) sourceBits.push("includes pasted dashboard");
        metaEl.textContent = sourceBits.join(" · ");

        liveEl.innerHTML = [
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

        if (reconcile) reconcile.open = !hasAny;

        const worst = Object.keys(free).reduce((w, k) => {
          const pct = free[k] > 0 ? ((totals[k] || 0) / free[k]) * 100 : 0;
          return Math.max(w, pct);
        }, 0);
        if (noteEl) {
          noteEl.classList.remove("warn", "bad");
          if (!hasAny) {
            noteEl.classList.add("warn");
            noteEl.textContent =
              "No Mapbox usage yet. Paste today’s numbers from account.mapbox.com → Statistics in the form below (Directions, Geocoding, Matching, Nav trips). Auto app metering needs OPS_USAGE_INGEST_TOKEN on Netlify plus a rebuild — customers never see any of this.";
          } else if (worst >= 90) {
            noteEl.classList.add("bad");
            noteEl.textContent =
              "≥90% of a free tier used this month. Check Mapbox Statistics for map loads/tiles too.";
          } else if (worst >= 70) {
            noteEl.classList.add("warn");
            noteEl.textContent =
              "≥70% of a free tier used this month. Map loads/tiles are not included in these cards.";
          } else {
            noteEl.textContent =
              "Month-to-date vs Mapbox free tiers (ops only). Map loads/tiles still only on Mapbox Statistics.";
          }
        }
      }

      function renderLedger() {
        const list = loadLedger().sort((a, b) => (a.date < b.date ? 1 : -1));
        document.getElementById("mbBars").innerHTML = [
          barHtml("Directions (month)", monthTotal(list, "directions"), FREE.directions),
          barHtml("Temp. geocoding (month)", monthTotal(list, "geocoding"), FREE.geocoding),
          barHtml("Map Matching (month)", monthTotal(list, "matching"), FREE.matching),
          barHtml("Nav trips (month)", monthTotal(list, "navTrips"), FREE.navTrips),
        ].join("");
        document.getElementById("mbTable").innerHTML = list
          .slice(0, 14)
          .map(
            (r) => `<tr>
              <td>${r.date}</td>
              <td>${Number(r.directions || 0).toLocaleString()}</td>
              <td>${Number(r.geocoding || 0).toLocaleString()}</td>
              <td>${Number(r.matching || 0).toLocaleString()}</td>
              <td>${Number(r.navTrips || 0).toLocaleString()}</td>
              <td><button type="button" class="ghost" data-del="${r.date}">Del</button></td>
            </tr>`
          )
          .join("");
        document.querySelectorAll("[data-del]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const date = btn.getAttribute("data-del");
            saveLedger(loadLedger().filter((r) => r.date !== date));
            renderLedger();
          });
        });
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
        // Home-api serves /ops-summary; Netlify keeps /.netlify/functions/ops-summary.
        const candidates = [
          "/ops-summary",
          "/.netlify/functions/ops-summary",
        ];
        let lastErr = "ops-summary failed";
        for (const path of candidates) {
          try {
            const res = await fetch(path, {
              headers: { Authorization: `Bearer ${secret}` },
              cache: "no-store",
            });
            if (res.ok) return res.json();
            const body = await res.json().catch(() => ({}));
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
        document.getElementById("mbDate").value = todayUTC();
        renderLedger();
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
            ? `Live summary unavailable (${summaryError}). Showing local health + Mapbox ledger.`
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

      document.getElementById("unlockBtn").addEventListener("click", () => {
        unlock(secretInput.value.trim());
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
      document.getElementById("mbSave").addEventListener("click", () => {
        const date = document.getElementById("mbDate").value || todayUTC();
        const row = {
          date,
          directions: Number(document.getElementById("mbDir").value || 0),
          geocoding: Number(document.getElementById("mbGeo").value || 0),
          matching: Number(document.getElementById("mbMatch").value || 0),
          navTrips: Number(document.getElementById("mbNav").value || 0),
        };
        const next = loadLedger().filter((r) => r.date !== date);
        next.push(row);
        saveLedger(next);
        renderLedger();
        renderLiveUsage(window.__opsLastMapboxSummary || null);
      });

      const existing = sessionStorage.getItem(SECRET_KEY);
      if (existing != null) {
        secretInput.value = existing;
        unlock(existing);
      }
