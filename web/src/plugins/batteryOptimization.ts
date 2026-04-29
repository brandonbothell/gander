import { registerPlugin } from '@capacitor/core'

export interface BatteryOptimizationPlugin {
  // Define your plugin methods here, for example:
  prompt(): Promise<void>
}

export const BatteryOptimization = registerPlugin<BatteryOptimizationPlugin>(
  'BatteryOptimization',
)
