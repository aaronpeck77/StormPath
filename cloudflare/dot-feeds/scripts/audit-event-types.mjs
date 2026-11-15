/* One-off audit: tally event_type/event_subtype across sampled WZDx feeds. */
const REG =
  "https://data.transportation.gov/resource/69qe-yiui.json?$where=active=true&$limit=300";
const KEYED = new Set([
  "idot_cwz", "iltollway", "txdot_v4_2", "ohio", "ptc", "vdot", "mtc", "nps",
  "cdot", "cdot_cwz", "mdot_4", "massdot__cwz", "ncdot", "ordot",
]);

const urlOf = (r) => {
  const u = r.url;
  if (typeof u === "string") return u;
  if (Array.isArray(u)) return typeof u[0] === "string" ? u[0] : u[0]?.url;
  return u?.url;
};
const reg = await (await fetch(REG)).json();
const rows = reg.filter((r) => typeof urlOf(r) === "string" && urlOf(r).startsWith("http"));
console.log("registry rows:", rows.length);

const keyless = rows.filter((r) => !KEYED.has(r.feedname ?? ""));
const step = Math.max(1, Math.floor(keyless.length / 12));
const chosen = [];
for (let i = 0; i < keyless.length && chosen.length < 12; i += step) chosen.push(keyless[i]);

const tally = {};
for (const r of chosen) {
  const url = urlOf(r);
  const name = r.feedname ?? r.state ?? "?";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const j = await res.json();
    const feats = j.features ?? j.data ?? [];
    let n = 0;
    for (const f of feats.slice(0, 800)) {
      const p = f.properties ?? f;
      const core = { ...p, ...(p.core_details ?? {}) };
      const t = `${core.event_type ?? "?"}|${core.event_subtype ?? core.subtype ?? "-"}`;
      tally[t] = (tally[t] ?? 0) + 1;
      n++;
    }
    console.log(name.padEnd(24), String(feats.length).padStart(6), "features,", n, "sampled");
  } catch (e) {
    console.log(name.padEnd(24), "FAIL", String(e.message ?? e).slice(0, 60));
  }
}

console.log("\n=== event_type|subtype tally ===");
Object.entries(tally)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(String(v).padStart(6), k));
