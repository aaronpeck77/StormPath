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
  /** Mapbox instruction language, for example "en" or "it". */
  language?: string;
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
  /** True after the electronic horizon has reported at least once this trip. */
  horizonReady?: boolean;
  /** Posted limit from the road-graph edge, miles per hour. Absent when unknown. */
  horizonLimitMph?: number | null;
  /** Incidents on the road ahead that the last route call may not have labeled. */
  horizonHazards?: Array<{
    kind: string;
    text: string;
    distanceM: number;
  }>;
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
  /**
   * Quit the iOS process after this many milliseconds if it is still in the
   * background. A drive must not call this.
   */
  armIdleExit(options: { afterMs: number }): Promise<void>;
  /** Forget a pending idle quit. Call when the app is on screen or a drive starts. */
  cancelIdleExit(): Promise<void>;
  /**
   * Brain P2 — download a TileStore corridor pack (map + nav tiles) along the
   * locked route polyline so the trip keeps rendering and can reroute offline.
   * Coordinates are [lng,lat] pairs. Resolves with the stable pack id.
   */
  startTripPack(options: {
    accessToken: string;
    coordinates: [number, number][];
  }): Promise<{ packId: string }>;
  /** Estimate corridor pack size in bytes before downloading (~\"84 MB\" UI). */
  estimateTripPack(options: {
    accessToken: string;
    coordinates: [number, number][];
  }): Promise<{ estimatedBytes: number }>;
  /** Cancel an in-flight corridor download. Pack stays on disk as-is. */
  cancelTripPack(): Promise<void>;
  /** Delete the corridor pack from TileStore (trip ended / user removed). */
  removeTripPack(): Promise<void>;
  /** On-disk state for the corridor pack — About sheet + diagnostics. */
  tripPackStatus(): Promise<{
    packId: string;
    exists: boolean;
    completedResourceCount?: number;
    completedResourceSize?: number;
    requiredResourceCount?: number;
  }>;
  /** Download/refresh a bounded home-region pack around [lng,lat] (~40km default). */
  setHomeRegion(options: {
    accessToken: string;
    center: [number, number];
    radiusMeters?: number;
  }): Promise<{ packId: string }>;
  /** On-disk state for the home-region pack. */
  homeRegionStatus(): Promise<{
    packId: string;
    exists: boolean;
    completedResourceCount?: number;
    completedResourceSize?: number;
    requiredResourceCount?: number;
  }>;
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
