import { useCallback } from "react";
import { useTripPlanStore } from "../state/tripPlanStore";
import { spokenPlace } from "./spokenPlace";
import { shareEtaCard, type EtaShareData } from "../ui/etaShareCard";
import type { StormyActResult, StormyReply } from "./stormyFence";

export type SpokenPlaceResult =
  | { kind: "go"; name: string }
  | { kind: "ask"; say: string }
  | { kind: "miss" };

/**
 * Stormy's hands — dispatches a fenced {@link StormyReply} into real app
 * actions (place search, Go, route pick, radar, ETA share, end trip).
 * Extracted from App.tsx; deps are the App-owned callbacks it triggers.
 */
export function useStormyAct(deps: {
  acceptSpokenChoice: (utterance: string, asStop?: boolean) => Promise<string | null>;
  resolveSpokenPlace: (place: string, asStop?: boolean) => Promise<SpokenPlaceResult>;
  handleGo: () => void;
  handlePreviewRouteSelect: (id: string) => void;
  handleStopAndClear: () => void;
  setShowRadar: (on: boolean) => void;
  /** "Recenter on me" — App owns puck-follow mode + the recenter tick. */
  onRecenter: () => void;
  forecastPlaceShort: string | null;
  refreshTripInPlace: () => void;
  etaShareData: EtaShareData | null;
}): (reply: StormyReply) => Promise<StormyActResult> {
  const {
    acceptSpokenChoice,
    resolveSpokenPlace,
    handleGo,
    handlePreviewRouteSelect,
    handleStopAndClear,
    setShowRadar,
    onRecenter,
    forecastPlaceShort,
    refreshTripInPlace,
    etaShareData,
  } = deps;

  return useCallback(
    async (reply: StormyReply): Promise<StormyActResult> => {
      if (reply.clarify === "choice" && reply.place.trim()) {
        const chosen = await acceptSpokenChoice(reply.place, reply.stop);
        if (chosen) {
          const said = spokenPlace(chosen, forecastPlaceShort ?? "");
          const eta = useTripPlanStore.getState().plan.routes[0]?.baseEtaMinutes;
          const minutes = eta != null && Number.isFinite(eta) ? ` About ${Math.round(eta)} minutes.` : "";
          return reply.stop
            ? `Stop added at ${said}. You're still on the way.${minutes}`
            : `That's ${said}. Say go when you want to leave.${minutes}`;
        }
      }
      if (reply.action === "go_to" && reply.place.trim()) {
        const found = await resolveSpokenPlace(reply.place, reply.stop);
        if (found.kind === "ask") return found.say;
        if (found.kind === "miss") return "I couldn't find that.";
        const name = spokenPlace(found.name, forecastPlaceShort ?? "");
        const eta = useTripPlanStore.getState().plan.routes[0]?.baseEtaMinutes;
        const minutes =
          eta != null && Number.isFinite(eta) ? ` About ${Math.round(eta)} minutes.` : "";
        if (reply.stop) return `Stop added at ${name}. You're still on the way.${minutes}`;
        return `That's ${name}. Say go when you want to leave.${minutes}`;
      }
      if (reply.action === "start_drive") {
        const routes = useTripPlanStore.getState().plan.routes;
        if (!routes.length) return { say: "Where do you want to go?", clarify: "place" };
        handleGo();
        const eta = routes[0]?.baseEtaMinutes;
        return eta != null && Number.isFinite(eta)
          ? `Let's go. About ${Math.round(eta)} minutes.`
          : reply.say || "Let's go.";
      }
      if (reply.action === "use_route") {
        const route = useTripPlanStore.getState().plan.routes.find((r) => r.id === reply.routeId);
        if (!route) return "I don't have that route.";
        handlePreviewRouteSelect(route.id);
        const eta = route.baseEtaMinutes;
        return eta != null && Number.isFinite(eta)
          ? `Taking ${route.label}. About ${Math.round(eta)} minutes.`
          : reply.say || `Taking ${route.label}.`;
      }
      if (reply.action === "radar_on") {
        setShowRadar(true);
        return reply.say || "Radar's on.";
      }
      if (reply.action === "radar_off") {
        setShowRadar(false);
        return reply.say || "Radar's off.";
      }
      if (reply.action === "end_trip") {
        handleStopAndClear();
        return reply.say || "Trip's done.";
      }
      if (reply.action === "recenter") {
        onRecenter();
        return reply.say || "Centered on you.";
      }
      if (reply.action === "refresh") {
        refreshTripInPlace();
        return reply.say || "Refreshing.";
      }
      if (reply.action === "share_eta") {
        if (!etaShareData) return "There's no trip to share yet.";
        try {
          await shareEtaCard(etaShareData);
          return reply.say || "Shared.";
        } catch {
          return "Couldn't open sharing.";
        }
      }
    },
    [
      acceptSpokenChoice,
      resolveSpokenPlace,
      handleGo,
      handlePreviewRouteSelect,
      handleStopAndClear,
      setShowRadar,
      onRecenter,
      forecastPlaceShort,
      refreshTripInPlace,
      etaShareData,
    ]
  );
}
