import '@mantine/core/styles.css'
import '@gfazioli/mantine-video/styles.css'
import { useState, useEffect } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import { LoadingOverlay, MantineProvider } from '@mantine/core'
import theme from './theme'
import { API_BASE, setAuthHandlers, authFetch } from './main'
import {
  getDeviceFingerprint,
  getSessionId,
  Session,
  TrustedDevice,
} from './device-info'
import LoginLayout from './Layout/LoginLayout'
import FullLayout from './Layout/FullLayout'

export type RecordingType = {
  streamId: string
  filename: string
  duration: number
  motionTimestamps: number[]
}

export function debugLog(
  message: string,
  level: 'log' | 'warn' | 'error' = 'log',
) {
  if (import.meta.env.DEV) {
    if (level === 'log') console.log(message)
    else if (level === 'warn') console.warn(message)
    else if (level === 'error') console.error(message)
  }
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [_signedUrlCache, setSignedUrlCache] = useLocalStorage<{
    [cacheKey: string]: {
      url: string
      expiresAt: number
      streamId: string
      filename: string
      type: 'video' | 'thumbnail'
      lastAccessed: number
    }
  }>({ key: 'signedUrlCache', defaultValue: {} })
  const [_signedLiveThumbUrls, setSignedLiveThumbUrls] = useLocalStorage<{
    [streamId: string]: { url: string; expires: number }
  }>({ key: 'signedLiveThumbUrls', defaultValue: {} })
  const [_cachedRecordings, setCachedRecordings] = useLocalStorage<{
    [streamId: string]: RecordingType[]
  }>({ key: 'cachedRecordings', defaultValue: {} })
  const [_totalRecordings, setTotalRecordings] = useLocalStorage<{
    [streamId: string]: number
  }>({ key: 'totalRecordings', defaultValue: {} })
  const [_cachedRecordingRanges, setCachedRecordingRanges] = useLocalStorage<{
    [streamId: string]: Array<{ from: string; to: string }>
  }>({ key: 'cachedRecordingRanges', defaultValue: {} })
  const [_cachedPages, setCachedPages] = useLocalStorage<{
    [streamId: string]: number[]
  }>({ key: 'cachedPages', defaultValue: {} })
  const [knownSessions, setKnownSessions] = useLocalStorage<string[]>({
    key: 'knownSessionIds',
    defaultValue: [],
  })
  const [showSessionMonitor, setShowSessionMonitor] = useState(false)
  const [hasCheckedSessions, setHasCheckedSessions] = useState(false)
  const [sessions, setSessions] = useState<(Session & TrustedDevice)[]>([])

  // Helper: Try to refresh token
  const tryRefreshToken = async (): Promise<boolean> => {
    debugLog('=== STARTING TOKEN REFRESH ===')

    try {
      debugLog('Checking for API key in localStorage')
      if (localStorage.getItem('ak')) {
        debugLog('API key found in localStorage, skipping token refresh')
        setAuthenticated(true)
        return true
      }
    } catch {
      debugLog(
        'Error occurred while checking for API key in localStorage',
        'error',
      )
    }

    try {
      debugLog('Attempting to get refresh token from storage')

      const rtExists = (await cookieStore.get('_rtexists'))?.value
      if (!rtExists) {
        debugLog(
          `No refresh token available for refresh attempt, _rtexists: '${rtExists}'`,
          'warn',
        )
        setAuthenticated(false)
        return false
      }

      debugLog('Refresh token found, preparing refresh request')

      // Check if another tab is already refreshing
      const refreshInProgress = localStorage.getItem('tokenRefreshInProgress')
      if (refreshInProgress) {
        const startTime = parseInt(refreshInProgress)
        const timeSinceStart = Date.now() - startTime

        if (timeSinceStart < 5000) {
          debugLog(
            `Another tab is refreshing (${timeSinceStart}ms ago), waiting...`,
          )

          return new Promise((resolve) => {
            let attempts = 0
            const maxAttempts = 50 // 5 seconds max wait
            const tokenChannel = new BroadcastChannel('tokenUpdates')

            const handleTokenUpdate = (event: MessageEvent) => {
              if (event.data.type === 'TOKEN_UPDATED') {
                debugLog(
                  'Another tab successfully refreshed token via broadcast',
                )
                setAuthenticated(true)
                tokenChannel.close()
                resolve(true)
              }
            }

            tokenChannel.addEventListener('message', handleTokenUpdate)

            const checkComplete = () => {
              attempts++
              const stillInProgress = localStorage.getItem(
                'tokenRefreshInProgress',
              )
              const newToken = localStorage.getItem('jwt')

              if (!stillInProgress && newToken) {
                debugLog(
                  'Another tab successfully refreshed token via localStorage check',
                )
                setAuthenticated(true)
                tokenChannel.close()
                resolve(true)
              } else if (!stillInProgress || attempts >= maxAttempts) {
                debugLog(
                  'Token refresh failed or timed out in other tab',
                  'error',
                )
                setAuthenticated(false)
                tokenChannel.close()
                resolve(false)
              } else {
                setTimeout(checkComplete, 100)
              }
            }
            setTimeout(checkComplete, 100)
          })
        } else {
          debugLog(
            `Stale refresh in progress flag detected (${timeSinceStart}ms old), clearing and proceeding`,
          )
          localStorage.removeItem('tokenRefreshInProgress')
        }
      }

      // Mark refresh as in progress
      localStorage.setItem('tokenRefreshInProgress', Date.now().toString())

      const deviceInfo = await getDeviceFingerprint()
      const data = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceInfo }),
      }

      const refreshStartTime = Date.now()
      // The current refresh token will be sent in the http only cookie
      const res = await Promise.race([
        fetch(`${API_BASE}/api/refresh-token`, data),
        new Promise<Response>((_, reject) =>
          setTimeout(
            () => reject(new Error('Token refresh request timeout')),
            15000,
          ),
        ),
      ])

      const requestDuration = Date.now() - refreshStartTime
      debugLog(
        `Refresh token response received after ${requestDuration}ms, status: ${res.status}`,
      )

      if (res.status === 200) {
        const data = await res.json()
        if (data && data.token && data.refreshToken) {
          debugLog('Token refresh successful, storing new tokens')

          localStorage.setItem('jwt', data.token)

          localStorage.removeItem('tokenRefreshInProgress')

          // Broadcast to all tabs
          const tokenChannel = new BroadcastChannel('tokenUpdates')
          tokenChannel.postMessage({
            type: 'TOKEN_UPDATED',
            token: data.token,
            timestamp: Date.now(),
          })
          tokenChannel.close()

          setAuthenticated(true)
          debugLog('=== TOKEN REFRESH SUCCESSFUL ===')
          return true
        } else {
          debugLog('Token refresh response missing required fields', 'error')
        }
      } else {
        debugLog(`Token refresh failed with status: ${res.status}`, 'error')
        try {
          const errorText = await res.text()
          debugLog(`Error response body: ${errorText}`, 'error')
        } catch (_) {
          debugLog('Could not read error response body', 'warn')
        }
      }
    } catch (error) {
      debugLog(`Token refresh error: ${error}`, 'error')
    }

    // Cleanup on failure
    debugLog('Token refresh failed, cleaning up', 'error')
    localStorage.removeItem('jwt')
    localStorage.removeItem('tokenRefreshInProgress')

    setAuthenticated(false)
    debugLog('=== TOKEN REFRESH FAILED ===')
    return false
  }

  // Enhanced logout function - PREVENT INFINITE LOOP
  const logout = async (skipBroadcast = false): Promise<void> => {
    try {
      localStorage.removeItem('ak')
    } catch {
      /* ignore */
    }
    try {
      const rtExists = (await cookieStore.get('_rtexists'))?.value
      if (!rtExists) {
        debugLog(
          `No refresh token available for logout attempt, _rtexists: '${rtExists}'`,
          'warn',
        )
        setAuthenticated(false)
        return
      }

      const fingerprint = await getDeviceFingerprint()

      // Notify server of logout - use fetch directly to avoid recursive authFetch calls
      await fetch(`${API_BASE}/api/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ clientId: fingerprint.clientId }),
      }).catch(console.error)
    } catch (error) {
      console.error('Error during logout:', error)
    } finally {
      // Clear all tokens and authentication state
      localStorage.removeItem('jwt')
      setAuthenticated(false)

      // Only broadcast if not called from a broadcast event (prevent infinite loop)
      if (!skipBroadcast) {
        console.log('Broadcasting logout to other tabs')
        const tokenChannel = new BroadcastChannel('tokenUpdates')
        tokenChannel.postMessage({
          type: 'LOGOUT',
          timestamp: Date.now(),
        })
        tokenChannel.close()
      } else {
        console.log('Logout called from broadcast, skipping broadcast')
      }
    }
  }

  // 1. FIRST: Set up BroadcastChannel listener (before any token operations)
  useEffect(() => {
    const tokenChannel = new BroadcastChannel('tokenUpdates')

    const handleTokenUpdate = (event: MessageEvent) => {
      console.log('Token update received via broadcast: ' + event.data.type)

      if (event.data.type === 'TOKEN_UPDATED') {
        const newToken = event.data.token
        if (newToken) {
          // Update localStorage if it's different (in case this tab missed it)
          const currentToken = localStorage.getItem('jwt')
          if (currentToken !== newToken) {
            localStorage.setItem('jwt', newToken)
          }

          console.log('JWT updated via broadcast, staying authenticated')
          setAuthenticated(true)

          // Clear any pending refresh operations in this tab
          localStorage.removeItem('tokenRefreshInProgress')
        }
      } else if (event.data.type === 'LOGOUT') {
        console.log('Logout broadcast received - logging out this tab')
        // Call logout with skipBroadcast=true to prevent infinite loop
        logout(true)
      }
    }

    tokenChannel.addEventListener('message', handleTokenUpdate)
    console.log('BroadcastChannel listener set up')

    return () => {
      tokenChannel.removeEventListener('message', handleTokenUpdate)
      tokenChannel.close()
    }
  }, []) // Set up once on mount

  // 2. SECOND: Set up global auth handlers
  useEffect(() => {
    const logoutWrapper = () => logout(false) // Always broadcast from explicit logouts
    setAuthHandlers(logoutWrapper, tryRefreshToken)
    console.log('Global auth handlers set up')
  }, [])

  // 3. THIRD: Handle initial authentication (after listeners are ready)
  useEffect(() => {
    const initAuth = async () => {
      debugLog('=== STARTING INITIAL AUTH CHECK ===')

      // Add a small delay to ensure BroadcastChannel is fully set up
      await new Promise((resolve) => setTimeout(resolve, 50))

      const token = localStorage.getItem('jwt')

      if (token) {
        debugLog('Found existing JWT, assuming authenticated')
        setAuthenticated(true)
      } else {
        debugLog('No JWT found, attempting token refresh')
        await tryRefreshToken()
      }
    }

    debugLog('=== INITIAL AUTH CHECK COMPLETE ===')

    initAuth().catch((error) => {
      debugLog(`Critical error in initAuth: ${error}`, 'error')
      setAuthenticated(false)
    })
  }, []) // Run once on mount

  // Enhanced session checking function
  const checkForNewSessions = async () => {
    if (hasCheckedSessions || !authenticated) return

    try {
      console.log('Checking for new sessions...')
      const response = await authFetch(`${API_BASE}/api/user/sessions`)
      if (!response.ok) return

      const trustedDevices: TrustedDevice[] = await response.json()
      console.log(`Fetched ${trustedDevices.length} trusted devices`)

      // Create sessions list
      const sessionsList: (Session & TrustedDevice)[] = trustedDevices.map(
        (device) => {
          // Use the proper getSessionId function from SessionMonitor
          const sessionId = getSessionId(device.ip, device.deviceInfo)
          return {
            ip: device.ip,
            firstSeen: device.firstSeen,
            lastSeen: device.lastSeen,
            isNew: !knownSessions.includes(sessionId),
            geolocated: false, // Mark as not geolocated so SessionMonitor can handle it
            isGeolocating: false,
            location: undefined,
            deviceInfo: device.deviceInfo,
            loginCount: device.loginCount,
          }
        },
      )

      // Sort sessions with new ones first
      const sortedSessions = sessionsList.sort((a, b) =>
        a.isNew === b.isNew ? 0 : a.isNew ? -1 : 1,
      )
      setSessions(sortedSessions)

      // Check if there are new sessions
      const newSessionsDetected = sortedSessions.some((s) => s.isNew)

      if (newSessionsDetected) {
        console.log('New sessions detected, auto-showing session monitor')
        setShowSessionMonitor(true)
      }

      setHasCheckedSessions(true)
    } catch (error) {
      console.error('Error checking for new sessions:', error)
      setHasCheckedSessions(true)
    }
  }

  function checkLocalStorageStateConsistency() {
    try {
      const currentVersion = import.meta.env.VITE_REACT_APP_VERSION ?? '1.0.0'
      let lastUpdate = localStorage.getItem('lastUsedAppVersion')

      // If new version, reset cached data
      if (lastUpdate && lastUpdate !== currentVersion) {
        // Reset all cached states if the website was updated
        setCachedRecordings({})
        setCachedRecordingRanges({})
        setCachedPages({})
        setTotalRecordings({})
        setSignedUrlCache({})
        setSignedLiveThumbUrls({})
        localStorage.setItem('lastUsedAppVersion', currentVersion)
        alert('Cache reset due to website update or new deployment.')
      }
    } catch (err) {
      alert('Error checking localStorageState consistency!')
      console.error('LocalStorage consistency check failed:', err)
    }
  }

  useEffect(() => {
    checkLocalStorageStateConsistency()
  }, [])

  // Check for new sessions when authenticated
  useEffect(() => {
    if (authenticated === true) {
      // Delay session check to allow the app to fully load
      setTimeout(checkForNewSessions, 2000)
    }
  }, [authenticated, hasCheckedSessions, knownSessions])

  // Add periodic session checking (every 5 minutes)
  useEffect(() => {
    if (!authenticated) return

    const interval = setInterval(
      () => {
        // Reset hasCheckedSessions to allow periodic checks
        setHasCheckedSessions(false)
      },
      5 * 60 * 1000,
    ) // 5 minutes

    return () => clearInterval(interval)
  }, [authenticated])

  // --- Refresh JWT token every minute ---
  useEffect(() => {
    if (!authenticated) return
    const interval = setInterval(tryRefreshToken, 60000)
    return () => clearInterval(interval)
  }, [authenticated])

  // Add beforeunload event to clear sensitive data (optional)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Only clear JWT from memory, keep refresh token for next session
      // This is optional - you might want to keep the JWT for better UX
      const navigationEntries = performance.getEntriesByType(
        'navigation',
      ) as PerformanceNavigationTiming[]
      if (
        navigationEntries.length > 0 &&
        navigationEntries[0].type === 'reload'
      ) {
        // Only on refresh, not on navigation
        localStorage.removeItem('jwt')
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    if (!authenticated) {
      setAuthenticated(
        localStorage.getItem('ak') !== null ? true : authenticated,
      )
    }
  }, [])

  const handleLogin = async (token: string, refreshToken: string) => {
    // Show user-friendly error message
    if (
      !window.isSecureContext &&
      location.protocol !== 'https:' &&
      location.hostname !== 'localhost'
    ) {
      alert(
        'Note: For enhanced security on remote devices, consider using HTTPS. Authentication will work but tokens will use basic encoding.',
      )
    }

    try {
      localStorage.setItem('jwt', token)
      setAuthenticated(true)
    } catch (error) {
      console.error('Error storing tokens:', error)

      // Still try to authenticate even if secure storage fails
      localStorage.setItem('jwt', token)
      // Store refresh token as base64 fallback
      // localStorage.setItem('_rt', btoa(refreshToken))
      setAuthenticated(true)
    }
  }

  // If authenticated is null, we'll show a loading overlay further down
  // If it's false, show a sign-in
  if (authenticated === false) {
    return (
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <LoginLayout
          onLogin={handleLogin}
          setAuthenticated={setAuthenticated}
        />
      </MantineProvider>
    )
  }

  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {authenticated ? (
        <FullLayout logout={logout} />
      ) : (
        <LoadingOverlay
          visible={true}
          zIndex={1000}
          overlayProps={{ radius: 'sm', blur: 2 }}
        />
      )}
    </MantineProvider>
  )
}
