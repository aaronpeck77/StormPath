export type CarSessionPublish = {
  navigating: boolean;
  destinationLabel?: string;
  advisoryLine?: string;
  maneuverLine?: string;
  conditionsJson?: string;
  radarTileBase?: string;
  puckColor?: string;
  /** Posted limit in mph from Mapbox data only; 0 = no sourced value. */
  speedLimitMph?: number;
};

export interface StormpathCarSessionPlugin {
  publish(payload: CarSessionPublish): Promise<{ ok: boolean }>;
  clear(): Promise<void>;
  /** True while a CarPlay template scene is attached to this app. */
  carPlayConnected(): Promise<{ connected: boolean }>;
}

export declare const StormpathCarSession: StormpathCarSessionPlugin;
