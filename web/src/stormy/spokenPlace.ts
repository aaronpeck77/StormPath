/** What Stormy says for a place. The on-screen line keeps city, state, and ZIP. */

const STATE_BY_ABBREV: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
  nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
  or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota",
  tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

const STATE_NAMES = new Set(Object.values(STATE_BY_ABBREV));

function stateKey(raw: string): string {
  const cleaned = raw.replace(/\b\d{5}(?:-\d{4})?\b/g, "").replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return STATE_BY_ABBREV[cleaned] ?? cleaned;
}

function isState(raw: string): boolean {
  const key = stateKey(raw);
  return STATE_NAMES.has(key);
}

/**
 * Street and name, plus city or state only when they differ from where the driver is.
 * ZIP and country are never spoken.
 */
export function spokenPlace(full: string, here: string): string {
  const country = /^(?:united states(?: of america)?|usa|u\.s\.a\.|us)$/i;
  let parts = full
    .split(",")
    .map((part) => part.replace(/\b\d{5}(?:-\d{4})?\b/g, "").replace(/\s+/g, " ").trim())
    .filter((part) => part && !country.test(part));
  if (!parts.length) return full.replace(/\b\d{5}(?:-\d{4})?\b/g, "").replace(/\s+/g, " ").trim();

  const hereParts = here.split(",").map((part) => part.trim()).filter(Boolean);
  const hereCity = (hereParts[0] ?? "").toLowerCase();
  const hereState = hereParts[1] ? stateKey(hereParts[1]) : "";

  const last = parts[parts.length - 1] ?? "";
  if (isState(last)) {
    const sameState = Boolean(hereState) && stateKey(last) === hereState;
    parts = parts.slice(0, -1);
    const city = parts[parts.length - 1] ?? "";
    const sameCity = Boolean(hereCity) && city.toLowerCase() === hereCity;
    if (sameCity) parts = parts.slice(0, -1);
    else if (!sameState && hereState) parts.push(last.replace(/\b\d{5}(?:-\d{4})?\b/g, "").trim());
    else if (!hereState) parts.push(last.replace(/\b\d{5}(?:-\d{4})?\b/g, "").trim());
  }

  return parts.filter(Boolean).join(", ");
}
