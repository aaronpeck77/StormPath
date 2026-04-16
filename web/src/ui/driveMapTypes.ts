export type MapViewMode = "drive" | "topdown" | "route";

export type MapFocusRequest =
  | { kind: "point"; lng: number; lat: number; zoom?: number }
  | {
      kind: "hazardOverview";
      hazardLng: number;
      hazardLat: number;
    };

/** Padding: top = turn + storm advisory; bottom = search + toolbar + attribution strip */
export const MAIN_MAP_ROUTE_PADDING = {
  top: 188,
  bottom: 198,
  left: 16,
  right: 96,
} as const;
