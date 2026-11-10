import { registerPlugin } from '@capacitor/core'

export interface SecurePreferencesPlugin {
  // Define your plugin methods here, for example:
  getStringOrNull(options: { key: string }): Promise<{ value: string | null }>
  setString(options: { key: string; value: string }): Promise<void>
  unset(options: { key: string }): Promise<void>
}

export const SecurePreferences =
  registerPlugin<SecurePreferencesPlugin>('SecurePreferences')
