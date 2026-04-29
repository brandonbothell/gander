import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Capacitor } from '@capacitor/core'
import { LoadingProvider } from './LoadingProvider.tsx'
import { LoadingBar } from './components/LoadingBar'

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

export type CustomWindow = Window & {
  getDebugLogs: () => string
  clearDebugLogs: () => void
}

export const API_BASE = Capacitor.isNativePlatform()
  ? import.meta.env.VITE_BASE_URL // Use production URL for native apps
  : ''

if (isIOS()) {
  document.body.classList.add('ios')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoadingProvider>
      <LoadingBar />
      <App />
    </LoadingProvider>
  </StrictMode>,
)

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    console.log('Service Worker registered:', reg)
  })
}

function getToken() {
  const jwt = localStorage.getItem('jwt')
  return jwt ?? undefined
}

// Global logout function - will be set by App component
export let globalLogout: (() => Promise<void>) | null = null
export let globalTryRefreshToken: (() => Promise<boolean>) | null = null

export function setAuthHandlers(
  logout: () => Promise<void>,
  tryRefreshToken: () => Promise<boolean>,
) {
  globalLogout = logout
  globalTryRefreshToken = tryRefreshToken
}

// Track ongoing refresh attempts to prevent multiple simultaneous refreshes
let tokenRefreshPromise: Promise<boolean> | null = null
let isRefreshInProgress = false

export async function authFetch(input: RequestInfo, init: RequestInit = {}) {
  const token = getToken()
  const jwt = localStorage.getItem('jwt')

  if (!jwt && globalTryRefreshToken && globalLogout && !isRefreshInProgress) {
    isRefreshInProgress = true
    try {
      const refreshed = await globalTryRefreshToken()
      if (!refreshed) {
        await globalLogout()
        throw new Error('Authentication failed')
      }
    } finally {
      isRefreshInProgress = false
    }
  }

  // Use the latest JWT
  const finalJwt = localStorage.getItem('jwt') ?? undefined

  const makeRequest = (authToken?: string) => {
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: authToken
          ? `Bearer ${authToken}`
          : token
            ? `Bearer ${finalJwt}`
            : '',
      },
    })
  }

  const response = await makeRequest()
  // Try the request up to 3 times before attempting token refresh
  let attempt = 1
  let resp = response
  while (resp.status >= 500 && resp.status !== 401 && attempt < 3) {
    await new Promise((res) => setTimeout(res, 300 * attempt)) // Exponential backoff
    attempt++
    resp = await makeRequest()
    if (resp.status < 500 && resp.status !== 401) {
      return resp
    }
  }
  // If we get a 401 and we have refresh handlers, try to refresh the token
  if (resp.status === 401 && globalTryRefreshToken && globalLogout) {
    console.log('Received 401, attempting token refresh...')

    // If there's already a refresh in progress, wait for it
    if (tokenRefreshPromise) {
      const refreshSuccess = await tokenRefreshPromise
      if (refreshSuccess) {
        // Retry the original request with the new token
        const newToken = getToken()
        return await makeRequest(newToken)
      } else {
        // Refresh failed, logout
        await globalLogout()
        throw new Error('Authentication failed - logged out')
      }
    }

    // Start a new refresh attempt
    tokenRefreshPromise = globalTryRefreshToken()

    try {
      const tokenRefreshSuccess = await tokenRefreshPromise.catch(
        () => (tokenRefreshPromise = null),
      )
      if (tokenRefreshSuccess) {
        console.log('Token refresh successful, retrying request...')
        // Retry the original request with the new token
        const newToken = getToken()
        const retryResponse = await makeRequest(newToken)

        // If the retry also fails with 401, logout
        if (retryResponse.status === 401) {
          console.log('Retry request also failed with 401, logging out...')
          await globalLogout()
          throw new Error('Authentication failed after refresh - logged out')
        }

        return retryResponse
      } else {
        console.log('Token refresh failed, logging out...')
        await globalLogout()
        throw new Error('Token refresh failed - logged out')
      }
    } finally {
      // Clear the refresh promise when done
      tokenRefreshPromise = null
    }
  }

  return response
}

// Ask for notification permission
export async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission !== 'granted') {
    await Notification.requestPermission()
  }
}
// Fetch with retry logic for rate limiting

export async function fetchWithRetry<T extends Response>(
  fetchFn: () => Promise<T>,
  tries = 3,
  delay = 1000,
): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetchFn()

      if (response.status === 429) {
        console.warn(`Rate limit hit, attempt ${i + 1}/${tries}`)
        if (i === tries - 1) {
          throw new Error('Rate limit exceeded after multiple attempts')
        }
        // Exponential backoff: 1s, 2s, 4s
        const waitTime = delay * Math.pow(2, i)
        console.log(`Waiting ${waitTime}ms before retry...`)
        await new Promise((resolve) => setTimeout(resolve, waitTime))
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return response
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} failed:`, error)
      if (i === tries - 1) {
        throw error
      }
      // Wait before retry even for non-429 errors
      const waitTime = delay * Math.pow(2, i)
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }
  }
  throw new Error('Max retries exceeded')
}
