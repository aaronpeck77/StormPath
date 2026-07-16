import { useCallback, useEffect, useState } from "react";
import { mapboxReverseGeocode } from "../services/mapboxGeocode";
import {
  formatCoordsAreaLabel,
  shortenPlaceNameForForecast,
} from "../utils/forecastDisplay";
import { loadReturnTripLeg, type ReturnTripLeg } from "../nav/returnTripLeg";
import { tripPlanFromSavedRoute } from "../nav/planFromSavedRoute";
import type { SavedRoute } from "../nav/savedRoutes";
import type { LngLat, TripPlan } from "../nav/types";
import type { SearchSuggestion } from "../ui/SearchBar";
import type { MapViewMode } from "../ui/driveMapTypes";
import type { PendingSave } from "../state/uiStore";

export type UseSavedTripActionsDeps = {
  destLngLat: LngLat | null;
  destinationLabel: string;
  userLngLat: LngLat | null;
  locationError: string | null;
  forecastPlaceShort: string | null;
  mapboxToken: string;
  canAddPlace: boolean;
  canAddRoute: boolean;
  plan: TripPlan;
  lineFocusId: string;
  returnTripLeg: ReturnTripLeg | null;
  addPlace: (name: string, lngLat: LngLat) => void;
  resetNavigationPlanning: () => void;
  setPlan: (plan: TripPlan) => void;
  setDestLngLat: (dest: LngLat | null) => void;
  setDestinationLabel: (label: string) => void;
  setSearchText: (text: string) => void;
  setSearchExpanded: (on: boolean) => void;
  setAllowAutocomplete: (on: boolean) => void;
  setRouteError: (err: string | null) => void;
  setSuggestions: (s: SearchSuggestion[]) => void;
  setViewMode: (mode: MapViewMode) => void;
  setFitTrigger: (updater: (n: number) => number) => void;
  setSavedDrawerOpen: (on: boolean) => void;
  setTapHint: (hint: string | null) => void;
  setPendingSave: (save: PendingSave) => void;
  startRouteRecording: (lngLat: LngLat) => void;
  tryFinishRecording: () => LngLat[] | null;
  discardRouteRecording: () => void;
};

/** Save place/route, load saved path, return trip, and GPS recording actions. */
export function useSavedTripActions(deps: UseSavedTripActionsDeps) {
  const {
    destLngLat,
    destinationLabel,
    userLngLat,
    locationError,
    forecastPlaceShort,
    mapboxToken,
    canAddPlace,
    canAddRoute,
    plan,
    lineFocusId,
    returnTripLeg,
    addPlace,
    resetNavigationPlanning,
    setPlan,
    setDestLngLat,
    setDestinationLabel,
    setSearchText,
    setSearchExpanded,
    setAllowAutocomplete,
    setRouteError,
    setSuggestions,
    setViewMode,
    setFitTrigger,
    setSavedDrawerOpen,
    setTapHint,
    setPendingSave,
    startRouteRecording,
    tryFinishRecording,
    discardRouteRecording,
  } = deps;

  const [recordedSuggestName, setRecordedSuggestName] = useState("");
  const [recordedEndLabel, setRecordedEndLabel] = useState("Recorded destination");
  const [recordedStartLabel, setRecordedStartLabel] = useState("Start of path");

  const handleSaveCurrentDestination = useCallback(() => {
    if (!destLngLat) return;
    if (!canAddPlace) {
      setTapHint("Basic limit: 2 saved places. Upgrade to Plus for more.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    const name = destinationLabel.trim() || "Saved place";
    addPlace(name, destLngLat);
  }, [destLngLat, destinationLabel, addPlace, canAddPlace, setTapHint]);

  const handleSaveCurrentLocation = useCallback(async () => {
    if (!userLngLat) {
      setTapHint(
        locationError ?? "Turn on location first — allow it for this site in browser settings."
      );
      window.setTimeout(() => setTapHint(null), 8000);
      return;
    }
    if (!canAddPlace) {
      setTapHint("Basic limit: 2 saved places. Upgrade to Plus for more.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    const [lng, lat] = userLngLat;
    let name = forecastPlaceShort ?? formatCoordsAreaLabel(lat, lng);
    if (!forecastPlaceShort && mapboxToken) {
      const hit = await mapboxReverseGeocode(lng, lat, mapboxToken);
      if (hit?.placeName) name = shortenPlaceNameForForecast(hit.placeName);
    }
    addPlace(name, userLngLat);
    setTapHint(`Saved place: ${name}`);
    window.setTimeout(() => setTapHint(null), 4500);
  }, [
    userLngLat,
    locationError,
    forecastPlaceShort,
    mapboxToken,
    addPlace,
    canAddPlace,
    setTapHint,
  ]);

  const openSaveRouteSheet = useCallback(() => {
    if (!canAddRoute) {
      setTapHint("Basic limit: 1 saved route. Upgrade to Plus for more.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    const r = plan.routes.find((x) => x.id === lineFocusId) ?? plan.routes[0];
    if (!r?.geometry || r.geometry.length < 2 || !destLngLat) return;
    setPendingSave({
      kind: "route",
      geometry: r.geometry.map(([a, b]) => [a, b]),
      turnSteps: r.turnSteps,
      destinationLngLat: [...destLngLat],
      destinationLabel: destinationLabel.trim() || "Destination",
    });
  }, [
    plan.routes,
    lineFocusId,
    destLngLat,
    destinationLabel,
    canAddRoute,
    setPendingSave,
    setTapHint,
  ]);

  const handleLoadSavedRoute = useCallback(
    (sr: SavedRoute, opts?: { reverse?: boolean }) => {
      const reverse = opts?.reverse ?? false;
      resetNavigationPlanning();
      setPlan(tripPlanFromSavedRoute(sr, { reverse }));
      const dest: LngLat = reverse
        ? [sr.geometry[0]![0], sr.geometry[0]![1]]
        : [sr.destinationLngLat[0], sr.destinationLngLat[1]];
      const label = reverse ? sr.startLabel?.trim() || "Start of path" : sr.destinationLabel;
      setDestLngLat(dest);
      setDestinationLabel(label);
      setSearchText(label);
      setSearchExpanded(false);
      setAllowAutocomplete(true);
      setRouteError(null);
      setSuggestions([]);
      setViewMode("route");
      setFitTrigger((n) => n + 1);
      setSavedDrawerOpen(false);
      setTapHint(
        reverse
          ? "Reversed path — follow the line toward the original start."
          : "Saved path on map — follow your recorded line. Tap Go when ready."
      );
      window.setTimeout(() => setTapHint(null), 6000);
    },
    [
      resetNavigationPlanning,
      setPlan,
      setDestLngLat,
      setDestinationLabel,
      setSearchText,
      setSearchExpanded,
      setAllowAutocomplete,
      setRouteError,
      setSuggestions,
      setViewMode,
      setFitTrigger,
      setSavedDrawerOpen,
      setTapHint,
    ]
  );

  const handleReturnToPreviousDestination = useCallback(() => {
    const leg = returnTripLeg ?? loadReturnTripLeg();
    if (!leg || leg.geometry.length < 2) {
      setTapHint("No previous trip to return to yet — start a route with Go first.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    if (!userLngLat) {
      setTapHint(
        locationError ?? "Turn on location first — allow it for this site in browser settings."
      );
      window.setTimeout(() => setTapHint(null), 8000);
      return;
    }
    const sr: SavedRoute = {
      id: "return-leg",
      name: "Return",
      geometry: leg.geometry,
      destinationLngLat: leg.outboundDestLngLat,
      destinationLabel: leg.outboundDestLabel,
      startLabel: leg.returnToLabel,
      createdAt: leg.savedAtMs,
    };
    handleLoadSavedRoute(sr, { reverse: true });
  }, [returnTripLeg, userLngLat, locationError, handleLoadSavedRoute, setTapHint]);

  const handleStartRecordingPath = useCallback(() => {
    if (!userLngLat) {
      setTapHint(locationError ?? "Turn on location to record a path.");
      window.setTimeout(() => setTapHint(null), 8000);
      return;
    }
    startRouteRecording(userLngLat);
    setSavedDrawerOpen(false);
  }, [userLngLat, startRouteRecording, locationError, setSavedDrawerOpen, setTapHint]);

  const handleStopRecordingSave = useCallback(() => {
    const geom = tryFinishRecording();
    if (!geom) {
      setTapHint("Keep driving — need ~150 ft and a few GPS points, then tap Stop & save again.");
      window.setTimeout(() => setTapHint(null), 5500);
      return;
    }
    const end = geom[geom.length - 1]!;
    setRecordedSuggestName(
      `Drive · ${new Date().toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`
    );
    setPendingSave({ kind: "recorded", geometry: geom, destinationLngLat: end });
  }, [tryFinishRecording, setPendingSave, setTapHint]);

  const handleDiscardRecordingPath = useCallback(() => {
    discardRouteRecording();
  }, [discardRouteRecording]);

  return {
    recordedSuggestName,
    recordedEndLabel,
    recordedStartLabel,
    setRecordedEndLabel,
    setRecordedStartLabel,
    handleSaveCurrentDestination,
    handleSaveCurrentLocation,
    openSaveRouteSheet,
    handleLoadSavedRoute,
    handleReturnToPreviousDestination,
    handleStartRecordingPath,
    handleStopRecordingSave,
    handleDiscardRecordingPath,
  };
}

/** Reverse-geocode labels when a recorded path is pending save. */
export function useRecordedSaveLabels(input: {
  pendingSave: PendingSave;
  mapboxToken: string;
  setRecordedEndLabel: (label: string) => void;
  setRecordedStartLabel: (label: string) => void;
}) {
  const { pendingSave, mapboxToken, setRecordedEndLabel, setRecordedStartLabel } = input;
  useEffect(() => {
    if (!pendingSave || pendingSave.kind !== "recorded") return;
    setRecordedEndLabel("Recorded destination");
    setRecordedStartLabel("Start of path");
    if (!mapboxToken) return;
    const [lng, lat] = pendingSave.destinationLngLat;
    const start = pendingSave.geometry[0];
    let cancelled = false;
    void mapboxReverseGeocode(lng, lat, mapboxToken).then((rev) => {
      if (!cancelled && rev?.placeName) setRecordedEndLabel(rev.placeName);
    });
    if (start) {
      void mapboxReverseGeocode(start[0]!, start[1]!, mapboxToken).then((rev) => {
        if (!cancelled && rev?.placeName) setRecordedStartLabel(rev.placeName);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [pendingSave, mapboxToken, setRecordedEndLabel, setRecordedStartLabel]);
}
