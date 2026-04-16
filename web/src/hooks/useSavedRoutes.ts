import { useCallback, useEffect, useState } from "react";
import type { LngLat, RouteTurnStep } from "../nav/types";
import type { SavedRoute } from "../nav/savedRoutes";
import { loadSavedRoutes, newSavedRouteId, persistSavedRoutes } from "../nav/savedRoutes";

export function useSavedRoutes() {
  const [routes, setRoutes] = useState<SavedRoute[]>(() => loadSavedRoutes());

  useEffect(() => {
    persistSavedRoutes(routes);
  }, [routes]);

  const addRoute = useCallback(
    (
      name: string,
      destinationLngLat: LngLat,
      destinationLabel: string,
      geometry: LngLat[],
      turnSteps?: RouteTurnStep[],
      startLabel?: string
    ) => {
      const trimmed = name.trim() || "Saved route";
      const geom = geometry.map(([a, b]) => [a, b] as LngLat);
      const steps = turnSteps?.length ? turnSteps.map((s) => ({ ...s })) : undefined;
      const sl = startLabel?.trim();
      setRoutes((prev) => [
        ...prev,
        {
          id: newSavedRouteId(),
          name: trimmed,
          destinationLngLat: [...destinationLngLat],
          destinationLabel: destinationLabel.trim() || "Destination",
          geometry: geom,
          turnSteps: steps,
          createdAt: Date.now(),
          ...(sl ? { startLabel: sl } : {}),
        },
      ]);
    },
    []
  );

  const updateName = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setRoutes((prev) => prev.map((r) => (r.id === id ? { ...r, name: trimmed } : r)));
  }, []);

  const removeRoute = useCallback((id: string) => {
    setRoutes((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { routes, addRoute, updateName, removeRoute };
}
