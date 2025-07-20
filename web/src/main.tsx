import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Capacitor } from '@capacitor/core';
import { LoadingProvider } from './LoadingContext';
import { LoadingBar } from './components/LoadingBar';
// @ts-ignore
import SecureStorage from './utils/secureStorage';

export const API_BASE =
  Capacitor.isNativePlatform()
    ? 'https://gander.onl'
    : '';

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
  navigator.serviceWorker.register('/sw.js').then(reg => {
    console.log('Service Worker registered:', reg);
  });
}

function getToken() {
  const jwt = localStorage.getItem('jwt');
  return jwt || undefined
}

// Global logout function - will be set by App component
export let globalLogout: (() => Promise<void>) | null = null;
export let globalTryRefreshToken: (() => Promise<boolean>) | null = null;

export function setAuthHandlers(logout: () => Promise<void>, tryRefreshToken: () => Promise<boolean>) {
  globalLogout = logout;
  globalTryRefreshToken = tryRefreshToken;
}

// Track ongoing refresh attempts to prevent multiple simultaneous refreshes
let refreshPromise: Promise<boolean> | null = null;

export async function authFetch(input: RequestInfo, init: RequestInit = {}) {
  const token = getToken();

  const makeRequest = (authToken?: string) => {
    return fetch(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: authToken ? `Bearer ${authToken}` : (token ? `Bearer ${token}` : ''),
      },
    });
  };

  try {
    const response = await makeRequest();

    // If we get a 401 and we have refresh handlers, try to refresh the token
    if (response.status === 401 && globalTryRefreshToken && globalLogout) {
      console.log('Received 401, attempting token refresh...');

      // If there's already a refresh in progress, wait for it
      if (refreshPromise) {
        const refreshSuccess = await refreshPromise;
        if (refreshSuccess) {
          // Retry the original request with the new token
          const newToken = getToken();
          return await makeRequest(newToken);
        } else {
          // Refresh failed, logout
          await globalLogout();
          throw new Error('Authentication failed - logged out');
        }
      }

      // Start a new refresh attempt
      refreshPromise = globalTryRefreshToken();

      try {
        const refreshSuccess = await refreshPromise;

        if (refreshSuccess) {
          console.log('Token refresh successful, retrying request...');
          // Retry the original request with the new token
          const newToken = getToken();
          const retryResponse = await makeRequest(newToken);

          // If the retry also fails with 401, logout
          if (retryResponse.status === 401) {
            console.log('Retry request also failed with 401, logging out...');
            await globalLogout();
            throw new Error('Authentication failed after refresh - logged out');
          }

          return retryResponse;
        } else {
          console.log('Token refresh failed, logging out...');
          await globalLogout();
          throw new Error('Token refresh failed - logged out');
        }
      } finally {
        // Clear the refresh promise when done
        refreshPromise = null;
      }
    }

    return response;
  } catch (error) {
    // Clear refresh promise on any error
    refreshPromise = null;
    throw error;
  }
}

// Ask for notification permission
export async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission !== 'granted') {
    await Notification.requestPermission();
  }
}
