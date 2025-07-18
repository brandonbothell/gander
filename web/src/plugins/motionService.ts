import { registerPlugin } from '@capacitor/core';

export interface MotionServicePlugin {
  // Define your plugin methods here, for example:
  startService(): Promise<void>;
  stopService(): Promise<void>;
}

export const MotionService = registerPlugin<MotionServicePlugin>('MotionService');
