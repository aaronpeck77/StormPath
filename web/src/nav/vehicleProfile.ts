import { safeStorage } from "../storage/safeStorage";

/**
 * Vehicle size profile — feeds Mapbox Directions `max_height` / `max_width` /
 * `max_weight` so routes avoid roads with posted limits the vehicle can't meet.
 *
 * "car" sends no params (Mapbox's own defaults already fit a car, and keeping
 * the request identical avoids changing routing for existing users). "large"
 * covers RVs, buses, and trucks — the dims are user-editable because rig
 * heights/weights vary.
 *
 * Honest limits: Mapbox restriction coverage varies by region and does not
 * cover hazmat, axle-weight, or trailer-length rules. This shapes the route
 * Mapbox computes; it is not a certified truck-legal router.
 */

export type VehicleMode = "car" | "large";

export interface VehicleProfile {
  mode: VehicleMode;
  /** Overall height, feet. */
  heightFt: number;
  /** Overall width, feet. */
  widthFt: number;
  /** Gross vehicle weight, pounds. */
  weightLb: number;
}

export const VEHICLE_PROFILE_STORAGE_KEY = "stormpath-vehicle-profile";

/** Starting dims shown when the user switches to "large" — a typical Class A motorhome. */
export const RV_VEHICLE_DIMS = { heightFt: 13.5, widthFt: 8.5, weightLb: 30000 } as const;
/** Semi-truck defaults: 13'6" legal height/width, 80,000 lb max GVW. */
export const TRUCK_VEHICLE_DIMS = { heightFt: 13.5, widthFt: 8.5, weightLb: 80000 } as const;

export const DEFAULT_VEHICLE_PROFILE: VehicleProfile = {
  mode: "car",
  ...RV_VEHICLE_DIMS,
};

/* Input clamps — all convert well inside the API's own ranges
 * (max 10 m / 10 m / 100 t) while staying sane for real vehicles. */
const MIN_HEIGHT_FT = 4;
const MAX_HEIGHT_FT = 20;
const MIN_WIDTH_FT = 4;
const MAX_WIDTH_FT = 12;
const MIN_WEIGHT_LB = 500;
const MAX_WEIGHT_LB = 150000;

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeVehicleProfile(raw: unknown): VehicleProfile {
  const o = (raw ?? {}) as Partial<VehicleProfile>;
  return {
    mode: o.mode === "large" ? "large" : "car",
    heightFt: clampNum(o.heightFt, MIN_HEIGHT_FT, MAX_HEIGHT_FT, RV_VEHICLE_DIMS.heightFt),
    widthFt: clampNum(o.widthFt, MIN_WIDTH_FT, MAX_WIDTH_FT, RV_VEHICLE_DIMS.widthFt),
    weightLb: clampNum(o.weightLb, MIN_WEIGHT_LB, MAX_WEIGHT_LB, RV_VEHICLE_DIMS.weightLb),
  };
}

export function readVehicleProfile(): VehicleProfile {
  const raw = safeStorage.get(VEHICLE_PROFILE_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_VEHICLE_PROFILE };
  try {
    return normalizeVehicleProfile(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VEHICLE_PROFILE };
  }
}

export function writeVehicleProfile(profile: VehicleProfile): void {
  safeStorage.set(VEHICLE_PROFILE_STORAGE_KEY, JSON.stringify(normalizeVehicleProfile(profile)));
}

export interface MapboxVehicleParams {
  max_height: number;
  max_width: number;
  max_weight: number;
}

const FT_TO_M = 0.3048;
const LB_TO_TONNES = 0.00045359237;

/**
 * Mapbox Directions vehicle-limit params, or null when the profile is "car"
 * (no params — identical requests to before this feature existed).
 */
export function vehicleProfileMapboxParams(profile: VehicleProfile): MapboxVehicleParams | null {
  if (profile.mode !== "large") return null;
  const max_height = Math.round(profile.heightFt * FT_TO_M * 1000) / 1000;
  const max_width = Math.round(profile.widthFt * FT_TO_M * 1000) / 1000;
  const max_weight = Math.round(profile.weightLb * LB_TO_TONNES * 1000) / 1000;
  if (
    !Number.isFinite(max_height) || max_height <= 0 || max_height > 10 ||
    !Number.isFinite(max_width) || max_width <= 0 || max_width > 10 ||
    !Number.isFinite(max_weight) || max_weight <= 0 || max_weight > 100
  ) {
    return null;
  }
  return { max_height, max_width, max_weight };
}
