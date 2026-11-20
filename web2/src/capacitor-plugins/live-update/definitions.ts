export interface DownloadOptions {
  /** HTTPS URL pointing to the signed .zip bundle */
  url: string
  /** Base64-encoded ECDSA P-256 signature of the .zip file */
  signature: string
}

export interface DownloadResult {
  /** The verified version extracted from the signed ota-manifest.json */
  version: string
  /** Local filesystem path where the bundle was staged */
  path: string
}

export interface LiveUpdatePlugin {
  /**
   * Confirms the current web bundle booted cleanly, promoting any pending
   * bundle to active and preventing automatic rollback on next launch.
   */
  notifyAppReady(): Promise<void>

  /**
   * Downloads a bundle over HTTPS, verifies its ECDSA signature, extracts it,
   * validates that its signed manifest version is newer, and stages it.
   */
  downloadAndPrepare(options: DownloadOptions): Promise<DownloadResult>

  /**
   * Immediately swaps the WebView serverBasePath to the staged pending bundle
   * and reloads the app.
   */
  applyPending(): Promise<void>
}
