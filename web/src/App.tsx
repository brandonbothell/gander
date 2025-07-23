import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './LoginPage';
import './App.css';
import { API_BASE, authFetch, setAuthHandlers } from './main';
import StreamPage from './StreamPage';
import { RouterLoadingHandler } from './components/RouterLoadingHandler';
import { useLocalStorageState } from './hooks/useLocalStorageState';
import SecureStorage from './utils/secureStorage';
import { getSessionId, SessionMonitor, type Session } from './components/SessionMonitor';
import { getDeviceFingerprint, type TrustedDevice } from '../../source/types/deviceInfo';
import { Capacitor } from '@capacitor/core';
import { debugLog } from './utils/debugLog';

export type Recording = { streamId: string, filename: string };

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [___, setCachedRecordings] = useLocalStorageState<{ [streamId: string]: Recording[] }>('cachedRecordings', {});
  const [____, setTotalRecordings] = useLocalStorageState<{ [streamId: string]: number }>('totalRecordings', {});
  const [__, setCachedRecordingRanges] = useLocalStorageState<{ [streamId: string]: Array<{ from: string, to: string }> }>('cachedRecordingRanges', {});
  const [_, setCachedPages] = useLocalStorageState<{ [streamId: string]: number[] }>('cachedPages', {});
  const [knownSessions, setKnownSessions] = useLocalStorageState<string[]>('knownSessionIds', []);
  const [showSessionMonitor, setShowSessionMonitor] = useState(false);
  const [hasCheckedSessions, setHasCheckedSessions] = useState(false);
  const [sessions, setSessions] = useState<(Session & TrustedDevice)[]>([]);

  // Helper: Try to refresh token
  const tryRefreshToken = async (): Promise<boolean> => {
    debugLog('=== STARTING TOKEN REFRESH ===');

    try {
      debugLog('Attempting to get refresh token from storage');
      const refreshToken = await SecureStorage.getRefreshToken();

      if (!refreshToken) {
        debugLog('No refresh token available for refresh attempt', 'warn');
        setAuthenticated(false);
        return false;
      }

      debugLog('Refresh token found, preparing refresh request');

      // Check if another tab is already refreshing (only on web)
      if (!Capacitor.isNativePlatform()) {
        const refreshInProgress = localStorage.getItem('tokenRefreshInProgress');
        if (refreshInProgress) {
          const startTime = parseInt(refreshInProgress);
          const timeSinceStart = Date.now() - startTime;

          if (timeSinceStart < 5000) {
            debugLog(`Another tab is refreshing (${timeSinceStart}ms ago), waiting...`);

            return new Promise((resolve) => {
              let attempts = 0;
              const maxAttempts = 50; // 5 seconds max wait
              const tokenChannel = new BroadcastChannel('tokenUpdates');

              const handleTokenUpdate = (event: MessageEvent) => {
                if (event.data.type === 'TOKEN_UPDATED') {
                  debugLog('Another tab successfully refreshed token via broadcast');
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
                  debugLog('Another tab successfully refreshed token via localStorage check');
                  setAuthenticated(true);
                  tokenChannel.close();
                  resolve(true);
                } else if (!stillInProgress || attempts >= maxAttempts) {
                  debugLog('Token refresh failed or timed out in other tab', 'error');
                  setAuthenticated(false);
                  tokenChannel.close();
                  resolve(false);
                } else {
                  setTimeout(checkComplete, 100);
                }
              };
              setTimeout(checkComplete, 100);
            });
          } else {
            debugLog(`Stale refresh in progress flag detected (${timeSinceStart}ms old), clearing and proceeding`);
            localStorage.removeItem('tokenRefreshInProgress');
          }
        }
      }

      // Mark refresh as in progress (only on web)
      if (!Capacitor.isNativePlatform()) {
        localStorage.setItem('tokenRefreshInProgress', Date.now().toString());
      }

      const deviceInfo = getDeviceFingerprint();
      debugLog(`Making refresh token request to: ${API_BASE}/api/refresh-token`);

      const refreshStartTime = Date.now();
      const res = await Promise.race([
        fetch(`${API_BASE}/api/refresh-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'refresh-token': refreshToken
          },
          body: JSON.stringify({ deviceInfo })
        }),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Token refresh request timeout')), 15000)
        )
      ]);

      const requestDuration = Date.now() - refreshStartTime;
      debugLog(`Refresh token response received after ${requestDuration}ms, status: ${res.status}`);

      if (res.status === 200) {
        const data = await res.json();
        if (data && data.token && data.refreshToken) {
          debugLog('Token refresh successful, storing new tokens');

          await SecureStorage.setRefreshToken(data.refreshToken);
          localStorage.setItem('jwt', data.token);

          // Clear refresh flag (only on web)
          if (!Capacitor.isNativePlatform()) {
            localStorage.removeItem('tokenRefreshInProgress');
          }

          // Broadcast to all tabs (only on web)
          if (!Capacitor.isNativePlatform()) {
            const tokenChannel = new BroadcastChannel('tokenUpdates');
            tokenChannel.postMessage({
              type: 'TOKEN_UPDATED',
              token: data.token,
              timestamp: Date.now()
            });
            tokenChannel.close();
          }

          setAuthenticated(true);
          debugLog('=== TOKEN REFRESH SUCCESSFUL ===');
          return true;
        } else {
          debugLog('Token refresh response missing required fields', 'error');
        }
      } else {
        debugLog(`Token refresh failed with status: ${res.status}`, 'error');
        try {
          const errorText = await res.text();
          debugLog(`Error response body: ${errorText}`, 'error');
        } catch (e) {
          debugLog('Could not read error response body', 'warn');
        }
      }
    } catch (error) {
      debugLog(`Token refresh error: ${error}`, 'error');
    }

    // Cleanup on failure
    debugLog('Token refresh failed, cleaning up', 'error');
    await SecureStorage.removeRefreshToken();
    localStorage.removeItem('jwt');

    if (!Capacitor.isNativePlatform()) {
      localStorage.removeItem('tokenRefreshInProgress');
    }

    setAuthenticated(false);
    debugLog('=== TOKEN REFRESH FAILED ===');
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
      debugLog('=== STARTING INITIAL AUTH CHECK ===');

      // Add a small delay to ensure BroadcastChannel is fully set up
      await new Promise(resolve => setTimeout(resolve, 50));

      const token = localStorage.getItem('jwt');
      debugLog(`JWT in localStorage: ${token ? 'EXISTS' : 'NOT_FOUND'}`);

      // On native platforms, always check for refresh token even if JWT exists
      if (Capacitor.isNativePlatform()) {
        debugLog('Native platform detected, checking refresh token availability');

        try {
          const refreshToken = await SecureStorage.getRefreshToken();
          debugLog(`Refresh token check result: ${refreshToken ? 'EXISTS' : 'NOT_FOUND'}`);

          if (refreshToken) {
            if (token) {
              debugLog('Found both JWT and refresh token, testing JWT validity with server');

              // Test the JWT validity by making a quick API call
              try {
                const testResponse = await fetch(`${API_BASE}/api/user/sessions`, {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  }
                });

                if (testResponse.ok) {
                  debugLog('JWT is valid, setting authenticated to true');
                  setAuthenticated(true);
                  return;
                } else {
                  debugLog(`JWT test failed with status ${testResponse.status}, attempting refresh`);
                  const refreshSuccess = await tryRefreshToken();
                  if (!refreshSuccess) {
                    debugLog('Token refresh failed after JWT test failure', 'error');
                    setAuthenticated(false);
                  } else {
                    debugLog('Token refresh succeeded after JWT test failure');
                  }
                  return;
                }
              } catch (jwtTestError) {
                debugLog(`JWT test request failed: ${jwtTestError}`, 'error');
                debugLog('Falling back to token refresh due to JWT test error');

                const refreshSuccess = await tryRefreshToken();
                if (!refreshSuccess) {
                  debugLog('Token refresh failed after JWT test error', 'error');
                  setAuthenticated(false);
                } else {
                  debugLog('Token refresh succeeded after JWT test error');
                }
                return;
              }
            } else {
              debugLog('Found refresh token but no JWT, attempting token refresh');
              const refreshSuccess = await tryRefreshToken();
              if (!refreshSuccess) {
                debugLog('Token refresh failed on native platform, logging out', 'error');
                setAuthenticated(false);
              } else {
                debugLog('Token refresh succeeded on native platform');
              }
              return;
            }
          } else {
            debugLog('No refresh token found on native platform, user not authenticated');
            setAuthenticated(false);
            return;
          }
        } catch (storageError) {
          debugLog(`Storage access error on native platform: ${storageError}`, 'error');
          setAuthenticated(false);
          return;
        }
      } else {
        // Web platform logic (existing)
        debugLog('Web platform detected');
        if (token) {
          debugLog('Found existing JWT, assuming authenticated');
          setAuthenticated(true);
        } else {
          debugLog('No JWT found, attempting token refresh');
          await tryRefreshToken();
        }
      }

      debugLog('=== INITIAL AUTH CHECK COMPLETE ===');
    };

    initAuth().catch(error => {
      debugLog(`Critical error in initAuth: ${error}`, 'error');
      setAuthenticated(false);
    });
  }, []); // Run once on mount

  // Enhanced session checking function
  const checkForNewSessions = async () => {
    if (hasCheckedSessions || !authenticated) return;

    try {
      console.log('Checking for new sessions...');
      const response = await authFetch(`${API_BASE}/api/user/sessions`);
      if (!response.ok) return;

      const trustedDevices: TrustedDevice[] = await response.json();
      console.log(`Fetched ${trustedDevices.length} trusted devices`);

      // Create sessions list
      const sessionsList: (Session & TrustedDevice)[] = trustedDevices.map(device => {
        // Use the proper getSessionId function from SessionMonitor
        const sessionId = getSessionId(device.ip, device.deviceInfo);
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
        };
      });

      // Sort sessions with new ones first
      const sortedSessions = sessionsList.sort((a, b) => a.isNew === b.isNew ? 0 : a.isNew ? -1 : 1);
      setSessions(sortedSessions);

      // Check if there are new sessions
      const newSessionsDetected = sortedSessions.some(s => s.isNew);

      if (newSessionsDetected) {
        console.log('New sessions detected, auto-showing session monitor');
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

  // Add periodic session checking (every 5 minutes)
  useEffect(() => {
    if (!authenticated) return;

    const interval = setInterval(() => {
      // Reset hasCheckedSessions to allow periodic checks
      setHasCheckedSessions(false);
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [authenticated]);

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

    // Mark all sessions as known when closing
    if (sessions.length > 0) {
      const allSessionIds = sessions.map(s => getSessionId(s.ip, s.deviceInfo));
      setKnownSessions(prev => Array.from(new Set([...prev, ...allSessionIds])));

      // Update sessions state to reflect they're no longer new
      setSessions(prevSessions =>
        prevSessions.map(session => ({ ...session, isNew: false }))
      );
    }

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
        <Route path="/" element={
          <StreamPage
            onShowSessionMonitor={() => setShowSessionMonitor(true)}
            onSessionMonitorClosed={handleSessionMonitorClose}
            logout={logout}
          />
        } />
        <Route path="/stream/:streamId" element={
          <StreamPage
            onShowSessionMonitor={() => setShowSessionMonitor(true)}
            onSessionMonitorClosed={handleSessionMonitorClose}
            logout={logout}
          />
        } />
        <Route path="/recordings/:streamId/:filename" element={
          <StreamPage
            onShowSessionMonitor={() => setShowSessionMonitor(true)}
            onSessionMonitorClosed={handleSessionMonitorClose}
            logout={logout}
          />
        } />
      </Routes>
      {showSessionMonitor && (
        <SessionMonitor
          onClose={handleSessionMonitorClose}
          sessions={sessions} // Pass pre-fetched sessions
          knownSessions={knownSessions}
          setKnownSessions={setKnownSessions}
          setSessions={setSessions}
        />
      )}
    </Router>
  );
}
