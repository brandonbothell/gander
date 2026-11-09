import { type PreferencesPlugin } from '@capacitor/preferences'
import { type CapacitorGlobal } from '@capacitor/core'
import SecureStorage from './secure-storage'
import { DeviceInfo } from './device-info'

export type Recording = {
  streamId: string
  filename: string
  nickname: string
  duration: number
  motionTimestamps: number[]
}

export interface Stream {
  id: string
  nickname: string
  ffmpegInput: string
  rtspUser?: string
  rtspPass?: string
  createdAt: string
  updatedAt?: string
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    API_BASE: string
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Capacitor: CapacitorGlobal
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Preferences: PreferencesPlugin
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SecureStorage: typeof SecureStorage
    setAuthenticated: (param: boolean) => void
    getDeviceFingerprint: () => Promise<DeviceInfo>
  }
}
