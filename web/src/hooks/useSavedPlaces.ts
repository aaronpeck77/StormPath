import { useCallback, useEffect, useState } from "react";
import type { SavedPlace } from "../nav/savedPlaces";
import { loadSavedPlaces, newSavedPlaceId, persistSavedPlaces } from "../nav/savedPlaces";
import type { LngLat } from "../nav/types";
import { safeStorage } from "../storage/safeStorage";

function narrowPhoneDefaultSavedOnMap(): boolean {
  if (typeof window === "undefined") return true;
  return !window.matchMedia("(max-width: 520px)").matches;
}

export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlace[]>(() => loadSavedPlaces());
  const [showOnMap, setShowOnMap] = useState(() => {
    const v = safeStorage.get("stormpath-saved-places-on-map");
    if (v === "0") return false;
    if (v === "1") return true;
    return narrowPhoneDefaultSavedOnMap();
  });

  useEffect(() => {
    safeStorage.set("stormpath-saved-places-on-map", showOnMap ? "1" : "0");
  }, [showOnMap]);

  useEffect(() => {
    persistSavedPlaces(places);
  }, [places]);

  const addPlace = useCallback((name: string, lngLat: LngLat) => {
    const trimmed = name.trim() || "Saved place";
    setPlaces((prev) => [
      ...prev,
      { id: newSavedPlaceId(), name: trimmed, lngLat, createdAt: Date.now() },
    ]);
  }, []);

  const updateName = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPlaces((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  }, []);

  const removePlace = useCallback((id: string) => {
    setPlaces((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { places, showOnMap, setShowOnMap, addPlace, updateName, removePlace };
}
