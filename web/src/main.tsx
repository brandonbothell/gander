import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Capacitor } from '@capacitor/core';
import { LoadingProvider } from './LoadingContext';
import { LoadingBar } from './components/LoadingBar';

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
  return localStorage.getItem('jwt');
}

export function authFetch(input: RequestInfo, init: RequestInit = {}) {
  const token = getToken();
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: token ? `Bearer ${token}` : '',
    },
  });
}

// Ask for notification permission
export async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission !== 'granted') {
    await Notification.requestPermission();
  }
}
