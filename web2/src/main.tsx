import ReactDOM from 'react-dom/client'
import { StrictMode } from 'react'
import { Capacitor } from '@capacitor/core'
import SecureStorage from './secure-storage'
import App from './App'

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

export type CustomWindow = Window & {
  getDebugLogs: () => string
  clearDebugLogs: () => void
}

export const API_BASE = Capacitor.isNativePlatform()
  ? import.meta.env.CLIENT_ANDROID_ENV === 'development'
    ? import.meta.env.CLIENT_ANDROID_API_BASE_URL_DEVELOPMENT // Force local URL for Android in development
    : (import.meta.env.CLIENT_ANDROID_API_BASE_URL ?? // Use production URL for native apps
      import.meta.env.CLIENT_API_BASE_URL ??
      '')
  : ''

if (isIOS()) {
  document.body.classList.add('ios')
}

async function getTokenOrApiKey(): Promise<
  { token: string; type: 'jwt' | 'api' } | undefined
> {
  const jwt = await SecureStorage.getAccessToken()
  const apiKey = jwt ? null : atob(localStorage.getItem('ak') || '')
  return jwt
    ? { token: jwt, type: 'jwt' }
    : apiKey
      ? { token: apiKey, type: 'api' }
      : undefined
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
  const token = await getTokenOrApiKey()

  if (
    ((!token &&
      (!init.headers ||
        !(init.headers as { [key: string]: string })['Authorization'])) ||
      localStorage.getItem('forceRefresh') === '1') &&
    globalTryRefreshToken &&
    globalLogout &&
    !isRefreshInProgress
  ) {
    localStorage.setItem('forceRefresh', '0')
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
  const finalToken = await getTokenOrApiKey()
  const csrfToken = await SecureStorage.getCsrfToken()

  const makeRequest = (authToken?: {
    token: string
    type: 'jwt' | 'api'
  }): Promise<Response> => {
    return new Promise((resolve, reject) =>
      fetch(input, {
        ...init,
        // Normalize Authorization headers
        headers: {
          Authorization: authToken
            ? `${authToken.type === 'jwt' ? 'Bearer' : 'ApiKey'} ${authToken.token}`
            : finalToken
              ? `${finalToken.type === 'jwt' ? 'Bearer' : 'ApiKey'} ${finalToken.token}`
              : '',
          ...(init.headers ?? {}),
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
      })
        .then((response) => resolve(response))
        .catch((err) => {
          if (err instanceof TypeError) {
            console.warn(
              'TypeError making request: ' + err.message + '\n' + err.stack,
            )
            setTimeout(() => resolve(makeRequest(authToken)), 2000) // Try again after 2 seconds
          } else {
            console.warn(
              'Unknown error making request: ' + JSON.stringify(err, null, 2),
            )
            reject(err)
          }
        }),
    )
  }

  const response = await makeRequest()
  // Try the request up to 3 times before attempting token refresh
  let attempt = 1
  let resp = response
  while (
    resp.status >= 400 &&
    ![401, 429].includes(resp.status) &&
    attempt < 3
  ) {
    await new Promise((res) => setTimeout(res, 300 * attempt)) // Exponential backoff
    attempt++
    resp = await makeRequest()
    if (resp.status < 500 && ![401, 429].includes(resp.status)) {
      return resp
    }
  }

  if (resp.status === 429) {
    const rateLimitResetSeconds = resp.headers.has('RateLimit-Reset')
      ? Number.parseInt(resp.headers.get('RateLimit-Reset')!)
      : null
    console.warn(
      `A request was rate limited. Waiting for ${rateLimitResetSeconds}s to request again.`,
    )
    return new Promise<Response>((resolve) =>
      setTimeout(
        async () => resolve(await authFetch(input, init)),
        rateLimitResetSeconds ? rateLimitResetSeconds * 1000 : 5000,
      ),
    )
  }
  // If we get a 401 and we have refresh handlers, try to refresh the token
  if (resp.status === 401 && globalTryRefreshToken && globalLogout) {
    // If there's already a refresh in progress, wait for it
    if (tokenRefreshPromise) {
      console.warn('Received 401, waiting on current token refresh...')
      const refreshSuccess = await tokenRefreshPromise
      if (refreshSuccess) {
        // Retry the original request with the new token
        const newToken = (await SecureStorage.getAccessToken())!
        return makeRequest({ token: newToken, type: 'jwt' })
      } else {
        // Refresh failed, logout
        await globalLogout()
        throw new Error('Authentication failed - logged out')
      }
    }

    console.log('Received 401, attempting token refresh...')

    // Start a new refresh attempt
    tokenRefreshPromise = globalTryRefreshToken()

    try {
      const tokenRefreshSuccess = await tokenRefreshPromise.catch((error) => {
        console.error('Token refresh error: ' + error)
        return false
      })
      if (tokenRefreshSuccess) {
        console.log('Token refresh successful, retrying request...')
        // Retry the original request with the new token
        const newToken = (await SecureStorage.getAccessToken())!
        const retryResponse = await makeRequest({
          token: newToken,
          type: 'jwt',
        })

        if (retryResponse.status === 429) {
          const rateLimitResetSeconds = retryResponse.headers.has(
            'RateLimit-Reset',
          )
            ? Number.parseInt(retryResponse.headers.get('RateLimit-Reset')!)
            : null
          console.warn(
            `A request was rate limited. Waiting for ${rateLimitResetSeconds}s to request again.`,
          )
          return new Promise<Response>((resolve) =>
            setTimeout(
              async () => resolve(await authFetch(input, init)),
              rateLimitResetSeconds ? rateLimitResetSeconds * 1000 : 5000,
            ),
          )
        }

        // If the retry also fails with 401, logout
        if (retryResponse.status === 401) {
          console.warn('Retry request also failed with 401, logging out...')
          await globalLogout()
          throw new Error(
            'Authentication failed after attempting token refresh - logged out',
          )
        }

        return retryResponse
      } else {
        console.warn('Token refresh failed, logging out...')
        await globalLogout()
        throw new Error('Token refresh failed - logged out')
      }
    } catch (error) {
      // Clear the refresh promise when done
    }

    tokenRefreshPromise = null
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
        const rateLimitResetSeconds = response.headers.has('RateLimit-Reset')
          ? Number.parseInt(response.headers.get('RateLimit-Reset')!)
          : null
        if (i === tries - 1) {
          throw new Error('Rate limit exceeded after multiple attempts')
        }
        console.warn(
          `A request was rate limited. Waiting for ${rateLimitResetSeconds}s to request again (attempt ${i + 1}/${tries}).`,
        )
        const waitTime = rateLimitResetSeconds
          ? rateLimitResetSeconds * 1000
          : 5000
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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />,
  </StrictMode>,
)

let domReady = (cb: () => void) =>
  document.readyState === 'interactive' || document.readyState === 'complete'
    ? cb()
    : document.addEventListener('DOMContentLoaded', cb)

domReady(() => {
  // Display body when DOM is loaded
  document.body.style.visibility = 'visible'
})
