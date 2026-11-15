import { useSettingsStore } from "../state/settingsStore";
import { vehicleProfileMapboxParams } from "../nav/vehicleProfile";

/**
 * Applies the user's vehicle-size profile (About → Settings → Vehicle size)
 * to a Mapbox Directions URL as `max_height` / `max_width` / `max_weight`.
 * No-op for the default "car" profile — requests stay identical to before.
 */
export function applyVehicleRoutingParams(url: URL): void {
  const s = useSettingsStore.getState();
  const p = vehicleProfileMapboxParams({
    mode: s.vehicleMode,
    heightFt: s.vehicleHeightFt,
    widthFt: s.vehicleWidthFt,
    weightLb: s.vehicleWeightLb,
  });
  if (!p) return;
  url.searchParams.set("max_height", String(p.max_height));
  url.searchParams.set("max_width", String(p.max_width));
  url.searchParams.set("max_weight", String(p.max_weight));
}
