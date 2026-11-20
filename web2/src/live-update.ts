import { useEffect } from 'react'
import { Preferences } from '@capacitor/preferences'
import { Capacitor } from '@capacitor/core'
import { LiveUpdate } from './capacitor-plugins/live-update'

export function useLiveUpdater(updateEndpoint: string) {
  useEffect(() => {
    async function initLiveUpdate() {
      // 1. Sync the signed manifest.json version into Capacitor Preferences on boot
      try {
        const manifestRes = await fetch('/manifest.json', {
          cache: 'no-store',
        })
        if (manifestRes.ok) {
          const manifest = await manifestRes.json()
          if (manifest.version) {
            await Preferences.set({
              key: 'reactAppVersion',
              value: manifest.version,
            })
          }
        }
      } catch {
        // Ignore if running without a generated manifest
      }

      // 2. Confirm boot succeeded (safe no-op on Web, prevents rollback on Android)
      await LiveUpdate.notifyAppReady()

      // 3. Only check/download native bundles on native platforms
      if (!Capacitor.isNativePlatform()) return

      try {
        const { value: currentVersion } = await Preferences.get({
          key: 'reactAppVersion',
        })
        const res = await fetch(updateEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentVersion: currentVersion ?? '1.0.0' }),
        })

        if (!res.ok) return
        const data: { url?: string; signature?: string } = await res.json()

        if (data.url && data.signature) {
          const staged = await LiveUpdate.downloadAndPrepare({
            url: data.url,
            signature: data.signature,
          })
          console.log(`Staged verified Live Update v${staged.version}`)
        } else {
          console.log('Live Update check resulted in no update found')
        }
      } catch (err) {
        console.warn('Live Update check/download skipped or rejected:', err)
      }
    }

    initLiveUpdate()
  }, [updateEndpoint])
}
