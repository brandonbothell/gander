import { registerPlugin } from '@capacitor/core'

export interface AppIntegrityCheckPlugin {
  // Define your plugin methods here, for example:
  getAppCheckToken(): Promise<{ token: string } | { error: string }>
}

export const AppIntegrity =
  registerPlugin<AppIntegrityCheckPlugin>('AppIntegrityCheck')
