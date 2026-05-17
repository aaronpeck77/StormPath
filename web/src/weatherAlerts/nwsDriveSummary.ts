import type { NormalizedWeatherAlert } from "./types";
import { displayText } from "../utils/displayText";

/** NWS CAP-style sections in `description` (bullet + LABEL...). */
function capSection(description: string, label: string): string {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const t = description.replace(/\r\n/g, "\n");
  const re = new RegExp(`\\*\\s*${esc}\\.{3}\\s*([\\s\\S]*?)(?=\\n\\s*\\*|$)`, "i");
  let m = t.match(re);
  if (!m) {
    /* Some products use fewer dots or space before text */
    const re2 = new RegExp(`\\*\\s*${esc}\\.{1,3}\\s*([^\\n*]+)`, "i");
    m = t.match(re2);
  }
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
}

/** Alternate: WHAT / HAZARD without leading asterisk (rare). */
function capSectionLoose(description: string, label: string): string {
  const t = description.replace(/\r\n/g, "\n");
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${esc}\\.{3}\\s*([^\\n]+(?:\\n(?!\\s*\\*)[^\\n]+)*)`, "im");
  const m = t.match(re);
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
}

/** API `headline` is often only issuance boilerplate — not the hazard. */
export function nwsHeadlineIsIssuanceOnly(headline: string): boolean {
  const h = headline.trim();
  if (!h) return true;
  if (/\bissued\b.+\bby\s+NWS\b/i.test(h)) return true;
  if (/^\s*(special weather statement|severe thunderstorm warning|tornado warning)\s+issued\b/i.test(h)) {
    return true;
  }
  return false;
}

function firstMeaningfulSentence(description: string): string {
  const raw = description.replace(/\r\n/g, "\n");
  /* Prefer text after WHAT / first narrative block, not the header block */
  const afterWhat = raw.split(/\*\s*WHAT\.\.\./i)[1];
  const chunk = (afterWhat ?? raw).replace(/\r\n/g, "\n");
  const lines = chunk
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\* (WHERE|WHEN|IMPACTS?)\.\.\./i.test(l));
  const t = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const skip = /^(SPECIAL WEATHER STATEMENT|SEVERE WEATHER STATEMENT|WEATHER STATEMENT)/i;
  let body = t;
  if (skip.test(body)) body = body.replace(skip, "").trim();
  /* Drop leading "Issued at" style if present in description */
  body = body.replace(/^\s*issued\s+at\s+[^.]+\.\s*/i, "").trim();
  const cut = body.search(/[.!?](\s|$)/);
  if (cut > 25) return body.slice(0, cut + 1).trim();
  return body;
}

/** True if text is mostly a county / zone list (not useful while driving). */
export function nwsLooksLikeCountyList(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  const commas = (t.match(/,/g) ?? []).length;
  if (commas >= 5 && /count(y|ies)|parish|parishes|portions of|including the cities of/i.test(t)) {
    return true;
  }
  if (/^the following (counties|areas)/i.test(t) && commas >= 3) return true;
  return false;
}

/**
 * What is actually happening (rain, fog, wind, etc.) — not county lists.
 */
export function nwsWhatIsHappening(a: NormalizedWeatherAlert): string {
  const desc = a.description ?? "";
  let what = capSection(desc, "WHAT");
  if (!what) what = capSectionLoose(desc, "WHAT");
  if (what && !nwsLooksLikeCountyList(what)) return displayText(what);

  let hazard = capSection(desc, "HAZARD");
  if (!hazard) hazard = capSectionLoose(desc, "HAZARD");
  if (hazard) return displayText(hazard);

  const impacts = capSection(desc, "IMPACTS") || capSection(desc, "IMPACT");
  if (impacts && !nwsLooksLikeCountyList(impacts)) return displayText(impacts);

  const first = firstMeaningfulSentence(desc);
  if (first && !nwsLooksLikeCountyList(first) && !nwsHeadlineIsIssuanceOnly(first)) {
    return displayText(first);
  }

  const hl = a.headline.trim();
  const hlBody = hl.replace(/^[^*]+?\*\s*WHAT\.\.\.\s*/i, "").trim() || hl;
  if (hlBody && !nwsLooksLikeCountyList(hlBody) && !nwsHeadlineIsIssuanceOnly(hlBody)) {
    return displayText(hlBody);
  }

  return displayText(a.event) || "Weather alert";
}

/** Advisory ticker / list — full hazard text (event + detail when distinct). */
export function nwsGlanceSummary(a: NormalizedWeatherAlert): string {
  const full = displayText(nwsWhatIsHappening(a));
  const ev = displayText(a.event);
  if (!full) return ev || "Weather alert";
  if (!ev) return full;
  const evL = ev.toLowerCase();
  const fullL = full.toLowerCase();
  if (fullL.startsWith(evL) || fullL.includes(evL)) return full;
  return `${ev}: ${full}`;
}

/** One short line for “issued …” — optional subline in UI (not the hazard). */
export function nwsIssuedByLine(headline: string): string {
  const h = headline.trim();
  if (!h || !nwsHeadlineIsIssuanceOnly(h)) return "";
  return displayText(h);
}

/**
 * What to do (precautionary / preparedness) if present.
 */
export function nwsWhatToDo(a: NormalizedWeatherAlert): string {
  const prep =
    capSection(a.description, "PRECAUTIONARY / PREPAREDNESS ACTIONS") ||
    capSection(a.description, "PRECAUTIONARY/PREPAREDNESS ACTIONS") ||
    capSection(a.description, "PRECAUTIONARY");
  if (prep) return displayText(prep);
  return "";
}

/** One block for route-alert `detail` / tooltips — avoids leading with county `areaDesc`. */
export function nwsDetailForRouteStrip(a: NormalizedWeatherAlert): string {
  const what = nwsWhatIsHappening(a);
  const todo = nwsWhatToDo(a);
  const bits = [what, todo].filter(Boolean);
  if (bits.length) return bits.join("\n\n");
  return what;
}
