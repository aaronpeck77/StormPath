import type { LngLat, NavRoute } from "./types";
import { polylineLengthMeters } from "./routeGeometry";

const MI_PER_M = 1 / 1609.34;

/** Driving distance along the polyline (road geometry), miles. */
export function routeDistanceMiles(geometry: LngLat[]): number {
  return polylineLengthMeters(geometry) * MI_PER_M;
}

export function formatRouteDistanceMi(geometry: LngLat[]): string {
  if (geometry.length < 2) return "—";
  const mi = routeDistanceMiles(geometry);
  if (mi < 0.05) return "<0.1 mi";
  if (mi < 100) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/** One short line for UI: how this option was biased. */
export function routeConsiderationSummary(route: NavRoute): string {
  const L = route.label.toLowerCase();
  if (L.includes("scenic") || L.includes("country")) return "Country drive · backroads";
  if (L.includes("no interstate") || L.includes("no highway") || /\bhighway\b/.test(L)) {
    return "No interstate";
  }
  if (L.includes("main")) return "Main · fastest";
  if (L.includes("shortest")) return "Shorter distance";
  if (route.role === "fastest") return "Main · fastest";
  if (route.role === "hazardSmart") return "No interstate";
  if (route.role === "balanced") return "Country drive · backroads";
  return "Route option";
}

/**
 * Chip / dock label: consideration blurb, plus ETA delta vs the plan's fastest leg
 * so B reads as "No interstate · +8 min" instead of a bare letter.
 */
export function routePickDisplayLabel(
  route: NavRoute,
  etaMinutes: number,
  fastestEtaMinutes: number | null | undefined
): string {
  const blurb = routeConsiderationSummary(route);
  const fastest =
    fastestEtaMinutes != null && Number.isFinite(fastestEtaMinutes)
      ? Math.round(fastestEtaMinutes)
      : null;
  const eta = Math.round(etaMinutes);
  if (fastest != null && eta - fastest >= 1 && route.role !== "fastest") {
    return `${blurb} · +${eta - fastest} min`;
  }
  if (route.role === "fastest") return blurb.includes("fastest") ? "Main" : blurb;
  return blurb;
}

/** What rule the locked (or just-replanned) leg is following. */
export type LockedRouteKind = "fastest" | "no_interstate" | "backroads" | "unknown";

export function lockedRouteKind(route: {
  role?: NavRoute["role"] | null;
  label?: string | null;
} | null | undefined): LockedRouteKind {
  if (!route) return "unknown";
  if (route.role === "hazardSmart") return "no_interstate";
  if (route.role === "balanced") return "backroads";
  if (route.role === "fastest") return "fastest";
  const L = (route.label ?? "").toLowerCase();
  if (L.includes("no interstate") || L.includes("no highway")) return "no_interstate";
  if (L.includes("scenic") || L.includes("country")) return "backroads";
  if (L.includes("main") || L.includes("fastest")) return "fastest";
  return "unknown";
}

/**
 * Spoken + on-screen copy after an off-route replan. Names the rule that survived
 * (fastest stays fastest, no-interstate stays off the highway) instead of a generic
 * "new route from here."
 */
export function offRouteReplanCopy(input: {
  kind: LockedRouteKind;
  silent: boolean;
  hasAlternate: boolean;
}): { voice: string; hint: string | null } {
  if (input.kind === "no_interstate") {
    return {
      voice: input.silent ? "Updating — staying off interstates." : "New route — staying off interstates.",
      hint: input.silent ? null : "New route — staying off interstates.",
    };
  }
  if (input.kind === "backroads") {
    return {
      voice: input.silent ? "Updating backroads route." : "New backroads route from here.",
      hint: input.silent ? null : "New backroads route from here.",
    };
  }
  if (input.kind === "fastest") {
    const hint = input.hasAlternate
      ? "New fastest from here — B is on Map / Route."
      : "New fastest from here.";
    return {
      voice: input.silent ? "Updating fastest route." : "New fastest from here.",
      hint: input.silent ? null : hint,
    };
  }
  return {
    voice: input.silent ? "Updating your route." : "New route from here.",
    hint: input.silent
      ? null
      : input.hasAlternate
        ? "New route from here — B is on Map / Route."
        : "New route from here.",
  };
}
