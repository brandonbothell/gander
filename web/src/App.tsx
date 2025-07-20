import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './LoginPage';
import './App.css';
import RecordingPage, { type Recording } from './RecordingPage';
import { API_BASE, authFetch, setAuthHandlers } from './main';
import StreamPage from './StreamPage';
import { RouterLoadingHandler } from './components/RouterLoadingHandler';
import { useLocalStorageState } from './hooks/useLocalStorageState';
import SecureStorage from './utils/secureStorage';
import { geolocateIP, SessionMonitor } from './components/SessionMonitor';

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [___, setCachedRecordings] = useLocalStorageState<{ [streamId: string]: Recording[] }>('cachedRecordings', {});
  const [____, setTotalRecordings] = useLocalStorageState<{ [streamId: string]: number }>('totalRecordings', {});
  const [__, setCachedRecordingRanges] = useLocalStorageState<{ [streamId: string]: Array<{ from: string, to: string }> }>('cachedRecordingRanges', {});
  const [_, setCachedPages] = useLocalStorageState<{ [streamId: string]: number[] }>('cachedPages', {});
  const [knownSessions] = useLocalStorageState<string[]>('knownSessions', []);
  const [showSessionMonitor, setShowSessionMonitor] = useState(false);
  const [hasCheckedSessions, setHasCheckedSessions] = useState(false);

  // Helper: Try to refresh token
  const tryRefreshToken = async (): Promise<boolean> => {
    try {
      const refreshToken = await SecureStorage.getRefreshToken();
      if (!refreshToken) {
        console.log('No refresh token found');
        setAuthenticated(false);
        return false;
      }

      const res = await fetch(`${API_BASE}/api/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'refresh-token': refreshToken
        }
      });

      if (res.status === 200) {
        const data = await res.json();
        if (data && data.token && data.refreshToken) {
          setAuthenticated(true);

          // Store new refresh token securely
          await SecureStorage.setRefreshToken(data.refreshToken);
          localStorage.setItem('jwt', data.token);

          // console.log('Token refreshed successfully');
          return true;
        }
      } else {
        console.error('Failed to refresh token:', res.status);
        const errorData = await res.json().catch(() => ({}));
        console.error('Error details:', errorData);
      }
    } catch (error) {
      console.error('Error during token refresh:', error);
    }

    // Clear invalid tokens
    setAuthenticated(false);
    await SecureStorage.removeRefreshToken();
    localStorage.removeItem('jwt');
    return false;
  };

  // Enhanced logout function
  const logout = async (): Promise<void> => {
    try {
      const refreshToken = await SecureStorage.getRefreshToken();
      if (refreshToken) {
        // Notify server of logout - use fetch directly to avoid recursive authFetch calls
        await fetch(`${API_BASE}/api/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'refresh-token': refreshToken
          }
        }).catch(console.error);
      }
    } catch (error) {
      console.error('Error during logout:', error);
    } finally {
      // Clear all tokens and authentication state
      await SecureStorage.clearAll();
      localStorage.removeItem('jwt');
      setAuthenticated(false);
    }
  };

  // Set global auth handlers for authFetch
  useEffect(() => {
    setAuthHandlers(logout, tryRefreshToken);
  }, []);

  // Enhanced login function
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

  // Check for new sessions on mount
  const checkForNewSessions = async () => {
    if (hasCheckedSessions) return;

    try {
      const response = await authFetch(`${API_BASE}/api/user/sessions`);
      if (!response.ok) return;

      const ips: string[] = await response.json();
      const currentSession = await geolocateIP(knownSessions)

      const newSessions = ips.filter(ip => ip !== currentSession.ip && !knownSessions.includes(ip));

      if (newSessions.length > 0) {
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

  // Refresh token on mount
  useEffect(() => {
    tryRefreshToken();
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

  // Add event listener for storage changes (multi-tab logout)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'jwt' && e.newValue === null) {
        // JWT was removed in another tab, logout this tab too
        logout();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

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
        <Route path="/" element={<StreamPage onShowSessionMonitor={() => setShowSessionMonitor(true)} />} />
        <Route path="/stream/:streamId" element={<StreamPage onShowSessionMonitor={() => setShowSessionMonitor(true)} />} />
        <Route path="/recordings/:streamId/:filename" element={<RecordingPage />} />
      </Routes>
      {showSessionMonitor && (
        <SessionMonitor onClose={() => setShowSessionMonitor(false)} />
      )}
    </Router>
  );
}
