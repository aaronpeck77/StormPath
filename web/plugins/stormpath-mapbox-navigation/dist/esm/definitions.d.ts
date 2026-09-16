export type NavCoordinate = {
  lng: number;
  lat: number;
  /** True = real stop. False = silent corridor shape. */
  separatesLegs?: boolean;
  /** Departing bearing for the origin (degrees). */
  headingDeg?: number;
};

export type StartActiveGuidanceOptions = {
  accessToken: string;
  /** Origin → silent shapes / vias → destination (WGS84). */
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
  /** Course from Mapbox enhanced location (degrees). */
  headingDeg?: number | null;
  /** Speed from Mapbox enhanced location (m/s). */
  speedMps?: number | null;
  /** True when native last-good pose rejected a leap. */
  poseHeld?: boolean;
  /** Native follow-cam sample (iOS owns framing). */
  camLng?: number;
  camLat?: number;
  camBearing?: number;
  camPitch?: number;
  camZoom?: number;
  /** True when native Drive map is visible through the WebView. */
  nativeMapShowing?: boolean;
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
  /** Calculate Core routes while the driver is still on Rt (Go then starts instantly). */
  prepareActiveGuidance(options: StartActiveGuidanceOptions): Promise<{
    ok: boolean;
    prepared?: boolean;
    cached?: boolean;
    skipped?: boolean;
    message?: string;
  }>;
  startActiveGuidance(options: StartActiveGuidanceOptions): Promise<{
    ok: boolean;
    reused?: boolean;
    message?: string;
  }>;
  /** Mute / unmute Mapbox spoken instructions during an active native session. */
  setVoiceGuidance(options: { enabled: boolean }): Promise<{ ok: boolean; enabled: boolean }>;
  /** Pin / hide the native heading-up Drive puck overlay. */
  setDrivePuckVisible(options: { visible: boolean }): Promise<{ ok: boolean; visible: boolean }>;
  /** Show / hide the native NavigationMapView under the WebView (Drive after Go). */
  setNativeMapVisible(options: {
    visible: boolean;
    /** Match the web basemap (day streets / night dark or navigation-night). */
    styleUrl?: string;
  }): Promise<{
    ok: boolean;
    visible: boolean;
    /** True when NavigationMapView is framed and showing through the WebView. */
    revealed?: boolean;
  }>;
  /**
   * Controlled intersections for the native Drive map (signals / stop / yield / rail),
   * from Mapbox Directions `intersections`. Pass an empty array to clear.
   */
  setRoadControls(options: {
    points: Array<{
      lng: number;
      lat: number;
      kind: "traffic_signal" | "stop_sign" | "yield_sign" | "railway_crossing";
    }>;
  }): Promise<{ ok: boolean; count: number }>;
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
