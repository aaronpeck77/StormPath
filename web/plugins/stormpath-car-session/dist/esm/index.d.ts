export type CarSessionPublish = {
  navigating: boolean;
  destinationLabel?: string;
  advisoryLine?: string;
  maneuverLine?: string;
};

export interface StormpathCarSessionPlugin {
  publish(payload: CarSessionPublish): Promise<{ ok: boolean }>;
  clear(): Promise<void>;
}

export declare const StormpathCarSession: StormpathCarSessionPlugin;
