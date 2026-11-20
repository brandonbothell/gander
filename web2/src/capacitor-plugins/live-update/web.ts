import { WebPlugin } from '@capacitor/core'
import type {
  DownloadOptions,
  DownloadResult,
  LiveUpdatePlugin,
} from './definitions'

export class LiveUpdateWeb extends WebPlugin implements LiveUpdatePlugin {
  async notifyAppReady(): Promise<void> {
    // No-op on web: browsers always load fresh assets directly from the web server
  }

  async downloadAndPrepare(options: DownloadOptions): Promise<DownloadResult> {
    console.debug(
      '[LiveUpdateWeb] downloadAndPrepare ignored on web platform.',
      options,
    )
    throw this.unimplemented(
      'Live Update bundle downloads are only supported on native platforms.',
    )
  }

  async applyPending(): Promise<void> {
    // Fallback to standard browser reload if called on web
    window.location.reload()
  }
}
