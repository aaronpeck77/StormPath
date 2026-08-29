export declare type DeviceMotionActivityResult = {
  activity: string;
  confidence: number | null;
};

export interface StormpathDeviceMotionPlugin {
  start(): Promise<{ ok: boolean }>;
  stop(): Promise<void>;
  getCurrent(): Promise<DeviceMotionActivityResult>;
}

export declare const StormpathDeviceMotion: StormpathDeviceMotionPlugin;
