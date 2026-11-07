import { useMemo } from "react";
import { useUiStore } from "../state/uiStore";
import type { NavRoute } from "../nav/types";
import type { ScoredRoute } from "../scoring/scoreRoutes";
import type { RouteSituationSlice } from "../situation/types";
import type { RouteImpact } from "../nav/routeImpacts";
import type { RouteForecast } from "../services/tomorrowIo";
import { useDepartureScan } from "./useDepartureScan";
import { buildTripBriefing, type TripBriefing } from "./tripBriefing";

export type UseTripBriefingResult = {
  open: boolean;
  /** False until the driver opens the briefing once — drives the pill pulse. */
  seen: boolean;
  /** Pill should pulse: briefing exists to be discovered and hasn't been opened. */
  pulse: boolean;
  briefing: TripBriefing | null;
  openBriefing: () => void;
  closeBriefing: () => void;
};

/**
 * Pre-trip briefing orchestration: uiStore open/seen state, the fetch-on-open
 * departure scan, and assembly of the sheet model. Kept out of App.tsx so the
 * monolith only sees `{ briefing, openBriefing, closeBriefing, pulse }`.
 *
 * The departure scan only runs while the sheet is open AND the user is Plus —
 * Basic users get the sheet's upgrade gate without spending a forecast call.
 */
export function useTripBriefing(opts: {
  isPlus: boolean;
  /** Focused planning route (the leg Go would take). */
  route: NavRoute | null | undefined;
  scored: ScoredRoute[];
  slice: RouteSituationSlice | undefined;
  impacts: RouteImpact[];
  forecast: RouteForecast | null;
  forecastProvider: "tomorrowIo" | "weatherKit" | null;
  suggestedRouteId: string | null;
  speedMps: number;
  weatherKitEnabled: boolean;
  tomorrowIoApiKey: string;
  useMiles: boolean;
  destinationLabel: string;
  originLabel?: string;
  letterFor: (routeId: string) => string;
}): UseTripBriefingResult {
  const {
    isPlus,
    route,
    scored,
    slice,
    impacts,
    forecast,
    forecastProvider,
    suggestedRouteId,
    speedMps,
    weatherKitEnabled,
    tomorrowIoApiKey,
    useMiles,
    destinationLabel,
    originLabel = "Your location",
    letterFor,
  } = opts;

  const open = useUiStore((s) => s.tripBriefingOpen);
  const seen = useUiStore((s) => s.tripBriefingSeen);
  const setOpen = useUiStore((s) => s.setTripBriefingOpen);
  const markSeen = useUiStore((s) => s.markTripBriefingSeen);

  const routeId = route?.id ?? null;
  const scoredEntry = useMemo(
    () => scored.find((s) => s.route.id === routeId),
    [scored, routeId]
  );

  const scan = useDepartureScan({
    enabled: open && isPlus && Boolean(route?.geometry?.length),
    geometry: route?.geometry ?? null,
    planEtaMinutes: route?.baseEtaMinutes ?? null,
    speedMps,
    apiKey: tomorrowIoApiKey,
    weatherKitEnabled,
  });

  const briefing = useMemo(() => {
    if (!route) return null;
    return buildTripBriefing({
      route,
      routeLetter: letterFor(route.id),
      routeLabel: route.label.trim() || `Route ${letterFor(route.id)}`,
      isSuggested: route.id === suggestedRouteId,
      destinationLabel,
      originLabel,
      scored: scoredEntry,
      allScored: scored,
      slice,
      impacts,
      forecast,
      forecastProvider,
      departureStatus: isPlus ? scan.status : "idle",
      departureAnalysis: isPlus ? scan.analysis : null,
      letterFor,
      suggestedRouteId,
      useMiles,
    });
  }, [
    route,
    letterFor,
    suggestedRouteId,
    destinationLabel,
    originLabel,
    scoredEntry,
    scored,
    slice,
    impacts,
    forecast,
    forecastProvider,
    isPlus,
    scan.status,
    scan.analysis,
    useMiles,
  ]);

  return {
    open,
    seen,
    pulse: !seen,
    briefing,
    openBriefing: () => {
      markSeen();
      setOpen(true);
    },
    closeBriefing: () => setOpen(false),
  };
}
