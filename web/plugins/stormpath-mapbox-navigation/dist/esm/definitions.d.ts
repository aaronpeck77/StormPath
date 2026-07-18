export type NavCoordinate = { lng: number; lat: number };

export type StartActiveGuidanceOptions = {
  accessToken: string;
  /** Origin → vias → destination (WGS84). */
  coordinates: NavCoordinate[];
  /** Use Mapbox simulated location (Xcode / desk testing). */
  simulate?: boolean;
};

export type NativeNavProgressEvent = {
  lng: number;
  lat: number;
  alongM: number;
  remainingM: number;
  onRoute: boolean;
  stepIndex: number;
  instruction?: string | null;
};

export type NativeNavRouteChangedEvent = {
  geometry: NavCoordinate[];
};

export type NativeNavFinishedEvent = {
  reason: "arrived" | "cancelled" | "error";
  message?: string;
};

export interface StormpathMapboxNavigationPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  startActiveGuidance(options: StartActiveGuidanceOptions): Promise<{ ok: boolean; message?: string }>;
  stop(): Promise<void>;
  addListener(
    eventName: "progress",
    listenerFunc: (event: NativeNavProgressEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: "routeChanged",
    listenerFunc: (event: NativeNavRouteChangedEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: "arrived",
    listenerFunc: (event: NativeNavFinishedEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: "cancelled",
    listenerFunc: (event: NativeNavFinishedEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: "error",
    listenerFunc: (event: NativeNavFinishedEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
}
