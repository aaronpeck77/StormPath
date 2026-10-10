/**
 * One suggestion for the collapsed advisory bar.
 * Status and Route Info keep the full list. This line is extra, and it stays quiet
 * unless the crossing-time answer is known and the weather is close enough to matter.
 */

import { haversineMeters } from "./routeGeometry";
import type { LngLat, RouteTurnStep } from "./types";
import type { RouteImpact } from "./routeImpacts";
import type { RoutePlaceAnchor } from "./routePlaceReference";
import type { MinutePrecipForecast } from "../services/tomorrowIo";

/** Same window official alerts already use before they lead the bar. */
export const PASSENGER_NEAR_MIN = 45;
/** Stay quiet while a turn banner is this close. */
export const PASSENGER_TURN_QUIET_M = 250;

const MIN_WAIT_MIN = 10;
const MAX_WAIT_MIN = 90;
const MILE_M = 1609.344;
const MAX_TOWN_M = 25 * MILE_M;
/** Minute-by-minute rain only describes the start of the trip. */
const MINUTE_PRECIP_APPLIES_ETA_MIN = 15;
const HEAVY_MM_HR = 4;

export type PassengerAdvisoryLine = {
  badge: "Leave" | "Ahead";
  text: string;
};

export function formatPassengerClock(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const min = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const mm = min < 10 ? `0${min}` : String(min);
  return `${h}:${mm} ${ap}`;
}

export function buildPassengerAdvisoryLine(input: {
  hasRoute: boolean;
  navigationStarted: boolean;
  metersToManeuver: number | null;
  nowMs: number;
  impacts: RouteImpact[] | null | undefined;
  placeAnchors: RoutePlaceAnchor[] | null | undefined;
  turnSteps: RouteTurnStep[] | null | undefined;
  userAlongM: number;
  totalM: number;
  planEtaMinutes: number | null;
  driveEtaMinutes: number | null;
  minutePrecip: MinutePrecipForecast | null | undefined;
}): PassengerAdvisoryLine | null {
  if (!input.hasRoute) return null;
  if (
    input.navigationStarted &&
    input.metersToManeuver != null &&
    Number.isFinite(input.metersToManeuver) &&
    input.metersToManeuver < PASSENGER_TURN_QUIET_M
  ) {
    return null;
  }

  const hit = pickSevereAhead(input.impacts);
  if (!hit) return headingIntoLine(input);

  const place = nearestTownName(hit.lngLat, input.placeAnchors);
  const where = place ? `by ${place}` : "ahead";
  const named = headingRank(hit.driverHeadline) > 0 ? eventName(hit.driverHeadline) : null;
  const kind = named
    ? `${/^[aeiou]/i.test(named) ? "an" : "a"} ${named}`
    : icy(hit)
      ? "icy weather"
      : "severe weather";
  const eta = hit.etaAheadMinutes ?? 0;

  if (!input.navigationStarted) {
    const wait =
      waitFromExpiry(input.nowMs, eta, hit.hazardExpiresIso) ??
      (eta <= MINUTE_PRECIP_APPLIES_ETA_MIN
        ? waitFromMinutes(input.minutePrecip, input.nowMs)
        : null);
    if (eta <= 8) {
      const lead = (named ? kind : "Severe weather");
      const titled = lead[0]!.toUpperCase() + lead.slice(1);
      return {
        badge: "Leave",
        text: wait
          ? `${titled} is close now. Waiting about ${wait.waitMin} minutes, until around ${formatPassengerClock(wait.untilMs)}, may let it pass before you go.`
          : `${titled} is close now. Waiting until it passes may be worth considering before you go.`,
      };
    }
    const meet = `If you leave now, you may meet ${kind} ${where}.`;
    if (!wait) return { badge: "Leave", text: meet };
    return {
      badge: "Leave",
      text: `${meet} Waiting about ${wait.waitMin} minutes, until around ${formatPassengerClock(wait.untilMs)}, may let you miss it.`,
    };
  }

  const town = townBeforeHazard({
    steps: input.turnSteps,
    userAlongM: input.userAlongM,
    totalM: input.totalM,
    remainEtaMin: input.driveEtaMinutes ?? input.planEtaMinutes,
    hazardAlongM: hit.startMeters,
    hazardPlace: place,
  });
  if (!town) return null;
  return {
    badge: "Ahead",
    text: `${kind[0]!.toUpperCase()}${kind.slice(1)} may still be ${where}. ${town.name} is about ${town.etaMin} minutes ahead, if you want to let it pass.`,
  };
}

function headingIntoLine(input: {
  impacts: RouteImpact[] | null | undefined;
  placeAnchors: RoutePlaceAnchor[] | null | undefined;
}): PassengerAdvisoryLine | null {
  const hit = pickHeadingInto(input.impacts);
  if (!hit) return null;
  const storm = friendlyStorm(hit.driverHeadline);
  const place = nearestTownName(hit.lngLat, input.placeAnchors);
  const where = place ? ` near ${place}` : "";
  const eta = etaPhrase(hit.etaAheadMinutes).replace(/^ about /, "");
  const clock = eta ? `, about ${eta}` : "";
  const when =
    hit.arrivalVerdict === "may_pass"
      ? "It looks like it may be gone before we get there."
      : "It still looks like it will be there when we arrive.";
  return {
    badge: "Ahead",
    text: `The path we're taking heads into ${storm}${where}${clock}. ${when}`,
  };
}

function friendlyStorm(headline: string): string {
  const watch = /\bwatch\b/i.test(headline);
  if (/hurricane/i.test(headline)) return watch ? "a hurricane watch" : "a hurricane";
  if (/typhoon/i.test(headline)) return watch ? "a typhoon watch" : "a typhoon";
  if (/tropical storm/i.test(headline)) return watch ? "a tropical storm watch" : "a tropical storm";
  if (/blizzard/i.test(headline)) return watch ? "a blizzard watch" : "a blizzard";
  if (/ice storm/i.test(headline)) return watch ? "an ice storm watch" : "an ice storm";
  if (/storm surge/i.test(headline)) return "a storm surge";
  if (/extreme wind/i.test(headline)) return "extreme wind";
  if (/tornado/i.test(headline)) return watch ? "a tornado watch" : "a tornado";
  if (/severe thunderstorm/i.test(headline)) return watch ? "a severe thunderstorm watch" : "a severe thunderstorm";
  const event = eventName(headline).toLowerCase();
  return /^[aeiou]/i.test(event) ? `an ${event}` : `a ${event}`;
}

function pickHeadingInto(impacts: RouteImpact[] | null | undefined): RouteImpact | null {
  if (!impacts?.length) return null;
  let best: RouteImpact | null = null;
  let bestRank = 0;
  let bestEta = Infinity;
  for (const impact of impacts) {
    if (impact.coarsePreview || impact.confidence === "low") continue;
    if (impact.arrivalVerdict !== "affects_you" && impact.arrivalVerdict !== "may_pass") continue;
    const eta = impact.etaAheadMinutes;
    if (eta == null || !Number.isFinite(eta) || eta < 0) continue;
    if (eta <= PASSENGER_NEAR_MIN) continue;
    const rank = headingRank(impact.driverHeadline);
    if (rank <= 0) continue;
    if (rank > bestRank || (rank === bestRank && eta < bestEta)) {
      best = impact;
      bestRank = rank;
      bestEta = eta;
    }
  }
  return best;
}

function headingRank(headline: string): number {
  if (
    /hurricane warning|typhoon warning|storm surge warning|tornado warning|extreme wind warning|blizzard warning|ice storm warning/i.test(
      headline
    )
  ) {
    return 5;
  }
  if (/hurricane watch|typhoon watch|tropical storm warning|blizzard watch|ice storm watch/i.test(headline)) {
    return 4;
  }
  if (/severe thunderstorm warning|tornado watch/i.test(headline)) return 3;
  if (/\bwarning\b/i.test(headline)) return 2;
  return 0;
}

function eventName(headline: string): string {
  return headline
    .replace(/\s+—\s+in this segment$/i, "")
    .replace(/\s+ahead$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function etaPhrase(etaMin: number | null): string {
  if (etaMin == null || !Number.isFinite(etaMin) || etaMin < 1) return "";
  if (etaMin < 60) return ` about ${Math.round(etaMin)} minutes ahead`;
  const h = Math.floor(etaMin / 60);
  const m = Math.round(etaMin % 60);
  const hourWord = h === 1 ? "hour" : "hours";
  const clock = m > 0 ? `${h} ${hourWord} ${m} minutes` : h === 1 ? "1 hour" : `${h} hours`;
  return ` about ${clock} ahead`;
}

function icy(impact: RouteImpact): boolean {
  return impact.category === "winter" || /ice|freez|slick/i.test(impact.driverHeadline);
}

function pickSevereAhead(impacts: RouteImpact[] | null | undefined): RouteImpact | null {
  if (!impacts?.length) return null;
  let best: RouteImpact | null = null;
  let bestEta = Infinity;
  for (const impact of impacts) {
    if (!isSevereAhead(impact)) continue;
    const eta = impact.etaAheadMinutes ?? Infinity;
    if (eta >= bestEta) continue;
    bestEta = eta;
    best = impact;
  }
  return best;
}

function isSevereAhead(impact: RouteImpact): boolean {
  if (impact.coarsePreview) return false;
  if (impact.confidence === "low") return false;
  if (impact.arrivalVerdict !== "affects_you") return false;
  if (
    impact.category === "traffic" ||
    impact.category === "closure" ||
    impact.category === "incident" ||
    impact.category === "construction"
  ) {
    return false;
  }
  const eta = impact.etaAheadMinutes;
  if (eta == null || !Number.isFinite(eta) || eta < 0 || eta > PASSENGER_NEAR_MIN) return false;
  if (/\bwatch\b/i.test(impact.driverHeadline)) return false;
  if (impact.severity === "avoid") return true;
  if (impact.severity !== "serious") return false;
  return /warning|thunder|tornado|hail|blizzard|ice|freezing|flood/i.test(impact.driverHeadline);
}

function nearestTownName(
  hazard: LngLat,
  anchors: RoutePlaceAnchor[] | null | undefined
): string | null {
  if (!anchors?.length) return null;
  let best: { name: string; meters: number } | null = null;
  for (const anchor of anchors) {
    const name = anchor.place?.trim();
    if (!name) continue;
    const meters = haversineMeters(anchor.lngLat, hazard);
    if (!Number.isFinite(meters) || meters > MAX_TOWN_M) continue;
    if (!best || meters < best.meters) best = { name, meters };
  }
  return best?.name ?? null;
}

function waitFromExpiry(
  nowMs: number,
  etaMin: number,
  expiresIso: string | null | undefined
): { waitMin: number; untilMs: number } | null {
  if (!expiresIso) return null;
  const exp = Date.parse(expiresIso);
  if (!Number.isFinite(exp)) return null;
  const expiryMin = (exp - nowMs) / 60_000;
  const waitMin = Math.ceil(expiryMin - etaMin);
  if (waitMin < MIN_WAIT_MIN || waitMin > MAX_WAIT_MIN) return null;
  return { waitMin, untilMs: nowMs + waitMin * 60_000 };
}

function waitFromMinutes(
  forecast: MinutePrecipForecast | null | undefined,
  nowMs: number
): { waitMin: number; untilMs: number } | null {
  const minutes = forecast?.minutes ?? [];
  if (minutes.length < MIN_WAIT_MIN) return null;
  if (Math.abs(nowMs - forecast!.fetchedAt) > 5 * 60_000) return null;
  let sawHeavy = false;
  const limit = Math.min(minutes.length, 60);
  for (let i = 0; i < limit; i++) {
    const heavy = (minutes[i]?.precipIntensityMmh ?? 0) >= HEAVY_MM_HR;
    if (heavy) {
      sawHeavy = true;
      continue;
    }
    if (!sawHeavy || i < MIN_WAIT_MIN) continue;
    let dry = 0;
    for (let j = i; j < Math.min(limit, i + 10); j++) {
      if ((minutes[j]?.precipIntensityMmh ?? 0) >= HEAVY_MM_HR) break;
      dry++;
    }
    if (dry < 10) continue;
    return { waitMin: i, untilMs: nowMs + i * 60_000 };
  }
  return null;
}

function townBeforeHazard(input: {
  steps: RouteTurnStep[] | null | undefined;
  userAlongM: number;
  totalM: number;
  remainEtaMin: number | null;
  hazardAlongM: number;
  hazardPlace: string | null;
}): { name: string; etaMin: number } | null {
  const steps = input.steps;
  if (!steps?.length) return null;
  if (!(input.totalM > input.userAlongM + 500)) return null;
  if (input.remainEtaMin == null || !(input.remainEtaMin > 0)) return null;
  const remainM = input.totalM - input.userAlongM;
  let along = 0;
  let best: { name: string; etaMin: number } | null = null;
  for (const step of steps) {
    const name = step.towardPlace?.trim();
    if (name) {
      const aheadOfYou = along > input.userAlongM + 400;
      const beforeStorm = along < input.hazardAlongM - 400;
      const sameTown =
        input.hazardPlace != null && name.toLowerCase() === input.hazardPlace.toLowerCase();
      if (aheadOfYou && beforeStorm && !sameTown) {
        const etaMin = Math.round((input.remainEtaMin * (along - input.userAlongM)) / remainM);
        if (etaMin >= 3 && etaMin <= 30 && (!best || etaMin < best.etaMin)) {
          best = { name, etaMin };
        }
      }
    }
    along += step.distanceM != null && Number.isFinite(step.distanceM) ? step.distanceM : 0;
  }
  return best;
}
