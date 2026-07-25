export type NavCoordinate = { lng: number; lat: number };

export type StartActiveGuidanceOptions = {
  accessToken: string;
  /** Origin → vias → destination (WGS84). */
  coordinates: NavCoordinate[];
  /** Use Mapbox simulated location (Xcode / desk testing). */
  simulate?: boolean;
  /** When false, do not attach Mapbox RouteVoiceController (Info → Voice prompts). */
  voiceEnabled?: boolean;
  /** Match StormPath preferred / no-interstate Go locks — exclude motorways. */
  preferBackroads?: boolean;
};

export type NativeNavProgressEvent = {
  lng: number;
  lat: number;
  alongM: number;
  remainingM: number;
  onRoute: boolean;
  stepIndex: number;
  /** Meters remaining on the current step (to the upcoming maneuver). */
  stepRemainingM?: number;
  instruction?: string | null;
  /** Road name for the step currently being traveled. */
  currentRoadName?: string | null;
  currentRoadRef?: string | null;
};

/** Live turn banner fields from Mapbox Navigation Core (iOS). */
export type NativeNavGuidance = {
  stepIndex: number;
  stepRemainingM: number | null;
  instruction: string | null;
  currentRoadName?: string | null;
  currentRoadRef?: string | null;
};

export type NativeNavRouteChangedEvent = {
  geometry: NavCoordinate[];
  /** Mapbox Core steps for the live route (banner + Then line). */
  turnSteps?: Array<{
    instruction: string;
    distanceM?: number;
    maneuverType?: string;
    maneuverModifier?: string;
    exitNumber?: string;
    roadName?: string;
    roadRef?: string;
  }>;
};

export type NativeNavFinishedEvent = {
  reason: "arrived" | "cancelled" | "error";
  message?: string;
};

export interface StormpathMapboxNavigationPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  startActiveGuidance(options: StartActiveGuidanceOptions): Promise<{ ok: boolean; message?: string }>;
  /** Mute / unmute Mapbox spoken instructions during an active native session. */
  setVoiceGuidance(options: { enabled: boolean }): Promise<{ ok: boolean; enabled: boolean }>;
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
