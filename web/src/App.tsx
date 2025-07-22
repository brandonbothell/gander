import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './LoginPage';
import './App.css';
import { API_BASE, authFetch, setAuthHandlers } from './main';
import StreamPage from './StreamPage';
import { RouterLoadingHandler } from './components/RouterLoadingHandler';
import { useLocalStorageState } from './hooks/useLocalStorageState';
import SecureStorage from './utils/secureStorage';
import { geolocateIP, getSessionId, SessionMonitor } from './components/SessionMonitor';
import { getDeviceFingerprint, type TrustedDevice } from '../../source/types/deviceInfo';

export type Recording = { streamId: string, filename: string };

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [___, setCachedRecordings] = useLocalStorageState<{ [streamId: string]: Recording[] }>('cachedRecordings', {});
  const [____, setTotalRecordings] = useLocalStorageState<{ [streamId: string]: number }>('totalRecordings', {});
  const [__, setCachedRecordingRanges] = useLocalStorageState<{ [streamId: string]: Array<{ from: string, to: string }> }>('cachedRecordingRanges', {});
  const [_, setCachedPages] = useLocalStorageState<{ [streamId: string]: number[] }>('cachedPages', {});
  const [knownSessions] = useLocalStorageState<string[]>('knownSessionIds', []);
  const [showSessionMonitor, setShowSessionMonitor] = useState(false);
  const [hasCheckedSessions, setHasCheckedSessions] = useState(false);

  // Helper: Try to refresh token
  const tryRefreshToken = async (): Promise<boolean> => {
    try {
      const refreshToken = await SecureStorage.getRefreshToken();
      if (!refreshToken) {
        setAuthenticated(false);
        return false;
      }

      // Check if another tab is already refreshing
      const refreshInProgress = localStorage.getItem('tokenRefreshInProgress');
      if (refreshInProgress) {
        const startTime = parseInt(refreshInProgress);
        // If refresh has been in progress for more than 10 seconds, assume it failed
        if (Date.now() - startTime < 10000) {
          console.log('Another tab is refreshing, waiting...');
          // Wait for the other tab to finish
          return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 100; // 10 seconds max wait

            const tokenChannel = new BroadcastChannel('tokenUpdates');

            const handleTokenUpdate = (event: MessageEvent) => {
              if (event.data.type === 'TOKEN_UPDATED') {
                console.log('Another tab successfully refreshed token via broadcast');
                setAuthenticated(true);
                tokenChannel.close();
                resolve(true);
              }
            };

            tokenChannel.addEventListener('message', handleTokenUpdate);

            const checkComplete = () => {
              attempts++;
              const stillInProgress = localStorage.getItem('tokenRefreshInProgress');
              const newToken = localStorage.getItem('jwt');

              if (!stillInProgress && newToken) {
                // Another tab successfully refreshed
                console.log('Another tab successfully refreshed token via localStorage check');
                setAuthenticated(true);
                tokenChannel.close();
                resolve(true);
              } else if (!stillInProgress || attempts >= maxAttempts) {
                // Refresh failed in other tab or timeout
                console.log('Token refresh failed or timed out in other tab');
                setAuthenticated(false);
                tokenChannel.close();
                resolve(false);
              } else {
                // Still in progress, check again
                setTimeout(checkComplete, 100);
              }
            };
            setTimeout(checkComplete, 100);
          });
        }
      }

      // Mark refresh as in progress
      console.log('This tab is performing token refresh');
      localStorage.setItem('tokenRefreshInProgress', Date.now().toString());

      const deviceInfo = getDeviceFingerprint();

      const res = await fetch(`${API_BASE}/api/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'refresh-token': refreshToken
        },
        body: JSON.stringify({ deviceInfo })
      });

      if (res.status === 200) {
        const data = await res.json();
        if (data && data.token && data.refreshToken) {
          await SecureStorage.setRefreshToken(data.refreshToken);

          // Update JWT in localStorage
          localStorage.setItem('jwt', data.token);
          localStorage.removeItem('tokenRefreshInProgress'); // Clear flag

          // Broadcast to all tabs immediately (listeners should be ready now)
          const tokenChannel = new BroadcastChannel('tokenUpdates');
          tokenChannel.postMessage({
            type: 'TOKEN_UPDATED',
            token: data.token,
            timestamp: Date.now()
          });
          console.log('Token refresh successful, broadcasted to all tabs');
          tokenChannel.close();

          setAuthenticated(true);
          return true;
        }
      }

      console.log('Token refresh failed - invalid response');
    } catch (error) {
      console.error('Error during token refresh:', error);
    }

    await SecureStorage.removeRefreshToken();
    localStorage.removeItem('jwt');
    localStorage.removeItem('tokenRefreshInProgress'); // Clear flag on failure
    setAuthenticated(false);
    return false;
  };

  // Enhanced logout function - PREVENT INFINITE LOOP
  const logout = async (skipBroadcast = false): Promise<void> => {
    try {
      const refreshToken = await SecureStorage.getRefreshToken();
      if (refreshToken) {
        // Notify server of logout - use fetch directly to avoid recursive authFetch calls
        await fetch(`${API_BASE}/api/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'refresh-token': refreshToken
          },
          body: JSON.stringify({ clientId: localStorage.getItem('clientId') })
        }).catch(console.error);
      }
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      // Clear all tokens and authentication state
      await SecureStorage.clearAll();
      localStorage.removeItem('jwt');
      setAuthenticated(false);

      // Only broadcast if not called from a broadcast event (prevent infinite loop)
      if (!skipBroadcast) {
        console.log('Broadcasting logout to other tabs');
        const tokenChannel = new BroadcastChannel('tokenUpdates');
        tokenChannel.postMessage({
          type: 'LOGOUT',
          timestamp: Date.now()
        });
        tokenChannel.close();
      } else {
        console.log('Logout called from broadcast, skipping broadcast');
      }
    }
  };

  // 1. FIRST: Set up BroadcastChannel listener (before any token operations)
  useEffect(() => {
    const tokenChannel = new BroadcastChannel('tokenUpdates');

    const handleTokenUpdate = (event: MessageEvent) => {
      console.log('Token update received via broadcast:', event.data);

      if (event.data.type === 'TOKEN_UPDATED') {
        const newToken = event.data.token;
        if (newToken) {
          // Update localStorage if it's different (in case this tab missed it)
          const currentToken = localStorage.getItem('jwt');
          if (currentToken !== newToken) {
            localStorage.setItem('jwt', newToken);
          }

          console.log('JWT updated via broadcast, staying authenticated');
          setAuthenticated(true);

          // Clear any pending refresh operations in this tab
          localStorage.removeItem('tokenRefreshInProgress');
        }
      } else if (event.data.type === 'LOGOUT') {
        console.log('Logout broadcast received - logging out this tab');
        // Call logout with skipBroadcast=true to prevent infinite loop
        logout(true);
      }
    };

    tokenChannel.addEventListener('message', handleTokenUpdate);
    console.log('BroadcastChannel listener set up');

    return () => {
      tokenChannel.removeEventListener('message', handleTokenUpdate);
      tokenChannel.close();
    };
  }, []); // Set up once on mount

  // 2. SECOND: Set up global auth handlers
  useEffect(() => {
    const logoutWrapper = () => logout(false); // Always broadcast from explicit logouts
    setAuthHandlers(logoutWrapper, tryRefreshToken);
    console.log('Global auth handlers set up');
  }, []);

  // 3. THIRD: Handle initial authentication (after listeners are ready)
  useEffect(() => {
    const initAuth = async () => {
      // Add a small delay to ensure BroadcastChannel is fully set up
      await new Promise(resolve => setTimeout(resolve, 50));

      const token = localStorage.getItem('jwt');
      if (token) {
        console.log('Found existing JWT, assuming authenticated');
        // If we have a JWT, assume authenticated (it will be validated on first API call)
        setAuthenticated(true);
      } else {
        console.log('No JWT found, attempting token refresh');
        // No JWT, try to refresh
        await tryRefreshToken();
      }
    };

    initAuth();
  }, []); // Run once on mount

  // Check for new sessions on mount
  const checkForNewSessions = async () => {
    if (hasCheckedSessions) return;

    try {
      const response = await authFetch(`${API_BASE}/api/user/sessions`);
      if (!response.ok) return;

      const trustedDevices: TrustedDevice[] = await response.json();
      const currentSession = await geolocateIP(knownSessions)
      const deviceInfo = getDeviceFingerprint();

      const newSessions = trustedDevices.some(device =>
        device.ip !== currentSession.ip &&
        device.deviceInfo.userAgent !== deviceInfo.userAgent &&
        !knownSessions.includes(getSessionId(device.ip, device.deviceInfo)));

      if (newSessions) {
        // Show session monitor automatically if there are new sessions
        setShowSessionMonitor(true);
      }

      setHasCheckedSessions(true);
    } catch (error) {
      console.error('Error checking for new sessions:', error);
      setHasCheckedSessions(true);
    }
  };

  function checkLocalStorageStateConsistency() {
    try {
      const LAST_UPDATE_KEY = 'lastUpdateTimestamp';
      const lastUpdate = localStorage.getItem(LAST_UPDATE_KEY);
      const currentVersion = import.meta.env.VITE_REACT_APP_VERSION || '1.0.0';

      // Use a versioned timestamp to detect updates
      const versionedUpdateKey = `${LAST_UPDATE_KEY}_${currentVersion}`;
      const lastVersionedUpdate = localStorage.getItem(versionedUpdateKey);

      // If new version, reset cached data
      if (lastUpdate !== lastVersionedUpdate) {
        // Reset all cached states if the website was updated
        const now = Date.now().toString();
        setCachedRecordings({});
        setCachedRecordingRanges({});
        setCachedPages({});
        setTotalRecordings({});
        localStorage.setItem(versionedUpdateKey, lastUpdate || now);
        if (!lastUpdate) localStorage.setItem(LAST_UPDATE_KEY, now);
        alert('Cache reset due to website update or new deployment.');
      }
    } catch (err) {
      alert('Error checking localStorageState consistency!');
      console.error('LocalStorage consistency check failed:', err);
    }
  }

  useEffect(() => {
    checkLocalStorageStateConsistency();
  }, []);

  // Check for new sessions when authenticated
  useEffect(() => {
    if (authenticated === true) {
      // Delay session check to allow the app to fully load
      setTimeout(checkForNewSessions, 2000);
    }
  }, [authenticated, hasCheckedSessions, knownSessions]);

  // --- Refresh JWT token every minute ---
  useEffect(() => {
    if (!authenticated) return;
    const interval = setInterval(tryRefreshToken, 60000);
    return () => clearInterval(interval);
  }, [authenticated]);

  // Add beforeunload event to clear sensitive data (optional)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Only clear JWT from memory, keep refresh token for next session
      // This is optional - you might want to keep the JWT for better UX
      const navigationEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      if (navigationEntries.length > 0 && navigationEntries[0].type === "reload") { // Only on refresh, not on navigation
        localStorage.removeItem('jwt');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // In App.tsx, add this function to handle session monitor closing
  const handleSessionMonitorClose = () => {
    setShowSessionMonitor(false);
    // Call the global handler if it exists (for mobile logout button)
    if ((window as any).handleSessionMonitorClose) {
      (window as any).handleSessionMonitorClose();
    }
  };

  const handleLogin = async (token: string, refreshToken: string) => {
    try {
      await SecureStorage.setRefreshToken(refreshToken);
      localStorage.setItem('jwt', token);
      setAuthenticated(true);
    } catch (error) {
      console.error('Error storing tokens:', error);
      // Fallback to not authenticated if storage fails
      setAuthenticated(false);
    }
  };

  if (authenticated === false) {
    return <LoginPage onLogin={handleLogin} />;
  }
  if (authenticated === null) {
    return <div className="App"><h2>Loading...</h2></div>;
  }

  return (
    <Router>
      <RouterLoadingHandler />
      <Routes>
        <Route path="/" element={<StreamPage onShowSessionMonitor={() => setShowSessionMonitor(true)} onSessionMonitorClosed={handleSessionMonitorClose} logout={logout} />} />
        <Route path="/stream/:streamId" element={<StreamPage onShowSessionMonitor={() => setShowSessionMonitor(true)} onSessionMonitorClosed={handleSessionMonitorClose} logout={logout} />} />
        <Route path="/recordings/:streamId/:filename" element={<StreamPage onShowSessionMonitor={() => setShowSessionMonitor(true)} onSessionMonitorClosed={handleSessionMonitorClose} logout={logout} />} />
      </Routes>
      {showSessionMonitor && (
        <SessionMonitor onClose={() => handleSessionMonitorClose()} />
      )}
    </Router>
  );
}
