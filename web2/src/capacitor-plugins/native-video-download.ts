import { registerPlugin } from '@capacitor/core'

export interface NativeVideoDownloadPlugin {
  openDownloads(): Promise<void>
  queueDownload(options: {
    url: string
    fileName: string
  }): Promise<{ downloadId: number; fileName: string }>
}

export const NativeVideoDownload = registerPlugin<NativeVideoDownloadPlugin>(
  'NativeVideoDownload',
)
