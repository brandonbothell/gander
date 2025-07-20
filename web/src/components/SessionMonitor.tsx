import React, { useEffect, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiMapPin, FiClock, FiGlobe } from 'react-icons/fi';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { authFetch, API_BASE } from '../main';
import { GOOGLE_MAPS_API_KEY } from '../../config.json';

interface Session {
  ip: string;
  location?: {
    country: string;
    region: string;
    city: string;
    lat: number;
    lon: number;
    isp?: string;
    timezone?: string;
    postal?: string;
    country_code?: string;
    asn?: string;
  };
  firstSeen: string;
  lastSeen: string;
  isNew?: boolean;
  isGeolocating?: boolean;
  geolocated?: boolean;
}

interface SessionMonitorProps {
  onClose: () => void;
}

declare global {
  interface Window {
    google: any;
  }
}

export const SessionMonitor: React.FC<SessionMonitorProps> = ({ onClose }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [knownSessions, setKnownSessions] = useLocalStorageState<string[]>('knownSessions', []);
  const [currentSessionIndex, setCurrentSessionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);

  // Prevent document scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Load Google Maps API
  useEffect(() => {
    if (window.google && window.google.maps && window.google.maps.Map) {
      setMapsLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&loading=async&libraries=geometry,marker&callback=initGoogleMaps`;
    script.async = true;
    script.defer = true;

    // Add a global callback function
    (window as any).initGoogleMaps = () => {
      console.log('Google Maps API loaded successfully');
      setMapsLoaded(true);
      // Clean up the global callback
      delete (window as any).initGoogleMaps;
    };

    script.onerror = () => {
      console.error('Failed to load Google Maps API');
      setError('Failed to load maps. Please check your internet connection.');
      // Clean up the global callback
      delete (window as any).initGoogleMaps;
    };

    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
      // Clean up the global callback if component unmounts
      if ((window as any).initGoogleMaps) {
        delete (window as any).initGoogleMaps;
      }
    };
  }, []);

  // Fetch sessions (without geolocation)
  useEffect(() => {
    if (hasLoadedSessions) return;

    const fetchSessions = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await authFetch(`${API_BASE}/api/user/sessions`);
        if (!response.ok) {
          throw new Error('Failed to fetch sessions');
        }

        const ips: string[] = await response.json();
        console.log(`Fetched ${ips.length} IP addresses`);

        // Create sessions without geolocation data
        const sessionsList: Session[] = ips.map(ip => ({
          ip,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          isNew: !knownSessions.includes(ip),
          geolocated: false,
          isGeolocating: false,
        }));

        // Sort sessions with new ones first
        setSessions(sessionsList.sort((a, b) => a.isNew === b.isNew ? 0 : a.isNew ? -1 : 1));

        const allIps = sessionsList.map(s => s.ip);
        setKnownSessions(prev => Array.from(new Set([...prev, ...allIps])));

        setHasLoadedSessions(true);
        setLoading(false);

      } catch (error: any) {
        console.error('Error fetching sessions:', error);
        setError(error.message || 'Failed to load session data');
        setLoading(false);
      }
    };

    fetchSessions();
  }, [hasLoadedSessions, knownSessions]);

  // Geolocate current session
  useEffect(() => {
    if (!sessions.length || currentSessionIndex >= sessions.length) return;

    const currentSession = sessions[currentSessionIndex];

    // Skip if already geolocated or currently geolocating
    if (currentSession.geolocated || currentSession.isGeolocating) return;

    const geolocateCurrentSession = async () => {
      console.log(`Geolocating current session: ${currentSession.ip}`);

      // Mark as geolocating
      setSessions(prev => prev.map((session, index) =>
        index === currentSessionIndex
          ? { ...session, isGeolocating: true }
          : session
      ));

      try {
        const updatedSession = await geolocateIP(knownSessions, currentSession.ip);

        // Update the session with geolocation data
        setSessions(prev => prev.map((session, index) =>
          index === currentSessionIndex
            ? {
              ...session,
              ...updatedSession,
              geolocated: true,
              isGeolocating: false
            }
            : session
        ));

      } catch (error) {
        console.error(`Failed to geolocate session ${currentSession.ip}:`, error);

        // Mark as failed geolocation
        setSessions(prev => prev.map((session, index) =>
          index === currentSessionIndex
            ? {
              ...session,
              geolocated: true,
              isGeolocating: false
            }
            : session
        ));
      }
    };

    geolocateCurrentSession();
  }, [sessions, currentSessionIndex, knownSessions]);

  // Initialize map when both maps API and current session location are loaded
  useEffect(() => {
    if (!mapsLoaded ||
      !window.google ||
      !window.google.maps ||
      !window.google.maps.Map ||
      !window.google.maps.marker ||
      !window.google.maps.marker.AdvancedMarkerElement ||
      sessions.length === 0 ||
      currentSessionIndex >= sessions.length) {
      return;
    }

    const currentSession = sessions[currentSessionIndex];
    if (!currentSession.location) {
      return;
    }

    const mapContainer = document.getElementById('session-map');
    if (!mapContainer) return;

    try {
      const map = new window.google.maps.Map(mapContainer, {
        center: { lat: currentSession.location.lat, lng: currentSession.location.lon },
        zoom: 10,
        mapTypeId: 'roadmap',
        mapId: 'f07b9b94ba34907f16488778'
      });

      new window.google.maps.marker.AdvancedMarkerElement({
        position: { lat: currentSession.location.lat, lng: currentSession.location.lon },
        map: map,
        title: `${currentSession.location.city}, ${currentSession.location.region}`,
      });
    } catch (error) {
      console.error('Error initializing Google Maps:', error);
      setError('Failed to initialize map. Please refresh the page.');
    }

  }, [mapsLoaded, sessions, currentSessionIndex]);

  const currentSession = sessions[currentSessionIndex];
  const newSessions = sessions.filter(s => s.isNew);

  if (loading) {
    return (
      <div
        style={{
          position: 'fixed',
          zIndex: 3000,
          left: 0,
          top: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            background: '#232b4a',
            borderRadius: 12,
            padding: 32,
            minWidth: 320,
            maxWidth: '90vw',
            boxShadow: '0 4px 32px #000a',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              border: '4px solid rgba(28, 241, 209, 0.3)',
              borderTop: '4px solid #1cf1d1',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <div>Loading session data...</div>
        </div>
      </div>
    );
  }

  if (error || sessions.length === 0) {
    return (
      <div
        style={{
          position: 'fixed',
          zIndex: 3000,
          left: 0,
          top: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: '#232b4a',
            borderRadius: 12,
            padding: 32,
            minWidth: 320,
            maxWidth: '90vw',
            boxShadow: '0 4px 32px #000a',
            color: '#fff',
            textAlign: 'center',
          }}
          onClick={e => e.stopPropagation()}
        >
          <h2 style={{ marginTop: 0, color: error ? '#ff6b6b' : '#fff' }}>
            {error ? 'Error' : 'No Sessions'}
          </h2>
          <p style={{ color: '#ccc' }}>
            {error || 'No active sessions found.'}
          </p>
          {error && (
            <p style={{ color: '#999', fontSize: '0.8em', marginTop: 8 }}>
              This could be due to rate limiting or network issues. Please try again in a few minutes.
            </p>
          )}
          <button
            onClick={onClose}
            style={{
              background: '#1cf1d1',
              color: '#232b4a',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: 16,
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 3000,
        left: 0,
        top: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#232b4a',
          borderRadius: 12,
          padding: 0,
          width: '90vw',
          height: '90vh',
          maxWidth: 800,
          maxHeight: 600,
          boxShadow: '0 4px 32px #000a',
          color: '#fff',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #444',
          display: 'flex',
          alignItems: 'center',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{
              margin: 0,
              fontSize: '1.5em',
              wordWrap: 'break-word',
              wordBreak: 'break-word'
            }}>
              Login History {newSessions.length > 0 && (
                <span style={{
                  background: '#ff6b6b',
                  color: '#fff',
                  borderRadius: '12px',
                  padding: '2px 8px',
                  fontSize: '0.7em',
                  marginLeft: 8,
                  whiteSpace: 'nowrap'
                }}>
                  {newSessions.length} new
                </span>
              )}
            </h2>
            <p style={{
              margin: '4px 0 0',
              color: '#ccc',
              fontSize: '0.9em',
              wordWrap: 'break-word'
            }}>
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} detected
            </p>
          </div>
        </div>

        {/* Session Navigation */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid #444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#1a1f35',
          flexShrink: 0,
        }}>
          <button
            onClick={() => setCurrentSessionIndex(Math.max(0, currentSessionIndex - 1))}
            disabled={currentSessionIndex === 0}
            style={{
              background: currentSessionIndex === 0 ? '#444' : '#1976d2',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              cursor: currentSessionIndex === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.9em',
              flexShrink: 0,
            }}
          >
            <FiChevronLeft size={currentSessionIndex === 0 ? 14 : 28} />
          </button>

          <div style={{ textAlign: 'center', minWidth: 0, flex: 1, margin: '0 12px' }}>
            {window.innerWidth > 600 && <div style={{
              fontWeight: 600,
              fontSize: '1.1em',
              wordBreak: 'break-all',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}>
              <span style={{
                color: '#1cf1d1',
                fontFamily: 'monospace',
                letterSpacing: '0.5px',
              }}>
                {currentSession.ip}
              </span>
              {currentSession.isNew && (
                <span style={{
                  background: '#ff6b6b',
                  color: '#fff',
                  borderRadius: '8px',
                  padding: '2px 6px',
                  fontSize: '0.7em',
                  marginLeft: 8,
                  whiteSpace: 'nowrap'
                }}>
                  NEW
                </span>
              )}
              {currentSession.isGeolocating && (
                <div style={{
                  width: 16,
                  height: 16,
                  border: '2px solid rgba(28, 241, 209, 0.3)',
                  borderTop: '2px solid #1cf1d1',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginLeft: 8,
                }} />
              )}
            </div>}
            <div style={{ color: '#ccc', fontSize: '0.9em' }}>
              {currentSessionIndex + 1} of {sessions.length}
            </div>
          </div>

          <button
            onClick={() => setCurrentSessionIndex(Math.min(sessions.length - 1, currentSessionIndex + 1))}
            disabled={currentSessionIndex === sessions.length - 1}
            style={{
              background: currentSessionIndex === sessions.length - 1 ? '#444' : '#1976d2',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              cursor: currentSessionIndex === sessions.length - 1 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.9em',
              flexShrink: 0,
            }}
          >
            <FiChevronRight size={currentSessionIndex === sessions.length - 1 ? 14 : 28} />
          </button>
        </div>

        {window.innerWidth <= 600 && <div style={{
          fontWeight: 700,
          fontSize: '1.3em',
          wordBreak: 'break-all',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          background: '#1a1f35',
          padding: '16px 24px',
          borderTop: '1px solid #444',
          borderBottom: '1px solid #444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          marginBottom: 0,
          flexShrink: 0,
        }}>
          <span style={{
            color: '#1cf1d1',
            fontFamily: 'monospace',
            letterSpacing: '0.5px',
          }}>
            {currentSession.ip}
          </span>
          {currentSession.isNew && (
            <span style={{
              background: '#ff6b6b',
              color: '#fff',
              borderRadius: '12px',
              padding: '6px 12px',
              fontSize: '0.7em',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 4px rgba(255,107,107,0.3)',
              animation: 'pulse 2s infinite',
            }}>
              NEW
            </span>
          )}
          {currentSession.isGeolocating && (
            <div style={{
              width: 20,
              height: 20,
              border: '3px solid rgba(28, 241, 209, 0.3)',
              borderTop: '3px solid #1cf1d1',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
          )}
        </div>}

        {/* Content - Scrollable */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          marginTop: window.innerWidth <= 600 ? 0 : 0,
        }}>
          {/* Session Details and Map */}
          <div style={{
            display: 'flex',
            flexDirection: window.innerWidth <= 600 ? 'column' : 'row',
            minHeight: '100%',
          }}>
            {/* Session Info */}
            <div style={{
              width: window.innerWidth <= 600 ? '100%' : '40%',
              padding: 24,
              borderRight: window.innerWidth <= 600 ? 'none' : '1px solid #444',
              borderBottom: window.innerWidth <= 600 ? '1px solid #444' : 'none',
              minHeight: window.innerWidth <= 600 ? 'auto' : '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              background: '#232b4a',
            }}>
              <h3 style={{
                margin: '0 0 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                wordWrap: 'break-word'
              }}>
                <FiMapPin /> Location Details
                {currentSession.isGeolocating && (
                  <div style={{
                    width: 16,
                    height: 16,
                    border: '2px solid rgba(28, 241, 209, 0.3)',
                    borderTop: '2px solid #1cf1d1',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    marginLeft: 'auto',
                  }} />
                )}
              </h3>

              {currentSession.isGeolocating ? (
                <div style={{
                  color: '#ccc',
                  fontStyle: 'italic',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <div style={{
                    width: 16,
                    height: 16,
                    border: '2px solid rgba(28, 241, 209, 0.3)',
                    borderTop: '2px solid #1cf1d1',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  Loading location data...
                </div>
              ) : currentSession.location ? (
                <div style={{ minWidth: 0 }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{
                      color: '#1cf1d1',
                      fontWeight: 600,
                      marginBottom: 4,
                      wordWrap: 'break-word',
                      wordBreak: 'break-word'
                    }}>
                      {currentSession.location.city}
                    </div>
                    <div style={{
                      color: '#ccc',
                      fontSize: '0.9em',
                      wordWrap: 'break-word',
                      wordBreak: 'break-word'
                    }}>
                      {currentSession.location.region}, {currentSession.location.country}
                    </div>
                    {currentSession.location.postal && (
                      <div style={{
                        color: '#999',
                        fontSize: '0.8em',
                        wordWrap: 'break-word'
                      }}>
                        {currentSession.location.postal}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{
                      color: '#fff',
                      fontSize: '0.9em',
                      marginBottom: 2,
                      wordWrap: 'break-word'
                    }}>
                      <FiGlobe style={{ display: 'inline', marginRight: 6 }} />
                      Coordinates
                    </div>
                    <div style={{
                      color: '#ccc',
                      fontSize: '0.8em',
                      wordBreak: 'break-all',
                      fontFamily: 'monospace'
                    }}>
                      {currentSession.location.lat.toFixed(4)}, {currentSession.location.lon.toFixed(4)}
                    </div>
                  </div>

                  {currentSession.location.isp && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{
                        color: '#fff',
                        fontSize: '0.9em',
                        marginBottom: 2,
                        wordWrap: 'break-word'
                      }}>
                        Organization
                      </div>
                      <div style={{
                        color: '#ccc',
                        fontSize: '0.8em',
                        wordWrap: 'break-word',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word'
                      }}>
                        {currentSession.location.isp}
                      </div>
                    </div>
                  )}

                  {currentSession.location.timezone && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{
                        color: '#fff',
                        fontSize: '0.9em',
                        marginBottom: 2,
                        wordWrap: 'break-word'
                      }}>
                        <FiClock style={{ display: 'inline', marginRight: 6 }} />
                        Timezone
                      </div>
                      <div style={{
                        color: '#ccc',
                        fontSize: '0.8em',
                        wordWrap: 'break-word',
                        wordBreak: 'break-word'
                      }}>
                        {currentSession.location.timezone}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  color: '#ccc',
                  fontStyle: 'italic',
                  wordWrap: 'break-word'
                }}>
                  Location information unavailable
                </div>
              )}

              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #444' }}>
                <div style={{
                  color: '#fff',
                  fontSize: '0.9em',
                  marginBottom: 8,
                  wordWrap: 'break-word'
                }}>
                  Session Status
                </div>
                <div style={{
                  display: 'inline-block',
                  background: currentSession.isNew ? '#ff6b6b' : '#1cf1d1',
                  color: currentSession.isNew ? '#fff' : '#232b4a',
                  padding: '4px 12px',
                  borderRadius: 12,
                  fontSize: '0.8em',
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }}>
                  {currentSession.isNew ? 'New Session' : 'Known Session'}
                </div>
              </div>
            </div>

            {/* Map */}
            <div style={{
              flex: 1,
              position: 'relative',
              minHeight: window.innerWidth <= 600 ? '300px' : '400px',
              minWidth: 0,
            }}>
              {currentSession.isGeolocating ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: window.innerWidth <= 600 ? '300px' : '400px',
                  background: '#1a1f35',
                  color: '#ccc',
                  fontSize: '1.1em',
                  padding: 20,
                  boxSizing: 'border-box'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      width: 48,
                      height: 48,
                      border: '4px solid rgba(28, 241, 209, 0.3)',
                      borderTop: '4px solid #1cf1d1',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      margin: '0 auto 16px',
                    }} />
                    <div style={{ wordWrap: 'break-word' }}>Loading map...</div>
                    <div style={{
                      fontSize: '0.8em',
                      marginTop: 4,
                      wordWrap: 'break-word'
                    }}>
                      Fetching location data
                    </div>
                  </div>
                </div>
              ) : currentSession.location ? (
                <div
                  id="session-map"
                  style={{
                    width: '100%',
                    height: '100%',
                    minHeight: window.innerWidth <= 600 ? '300px' : '400px',
                    background: '#1a1f35',
                  }}
                />
              ) : (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  minHeight: window.innerWidth <= 600 ? '300px' : '400px',
                  background: '#1a1f35',
                  color: '#ccc',
                  fontSize: '1.1em',
                  padding: 20,
                  boxSizing: 'border-box'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <FiMapPin size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
                    <div style={{ wordWrap: 'break-word' }}>Map unavailable</div>
                    <div style={{
                      fontSize: '0.8em',
                      marginTop: 4,
                      wordWrap: 'break-word'
                    }}>
                      Location data not found for this IP
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #444',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 12,
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              background: '#1cf1d1',
              color: '#232b4a',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const geolocateIP = async (knownSessions?: string[], ip?: string) => {
  try {
    // console.log(`Geolocating IP ${ip || 'local'}...`);

    const geoResponse = await fetchWithRetry(`https://ipinfo.io/${ip ? ip + '/' : ''}json`);
    const geoData = await geoResponse.json();

    // console.log(`Geolocation data for ${ip || 'local'}:`, geoData);

    if (geoData.error) {
      throw new Error(`API Error: ${geoData.error.message || 'Unknown error'}`);
    }

    const { ip: geoIp }: { ip: string } = geoData;
    const [lat, lon] = geoData.loc ? geoData.loc.split(',').map(Number) : [null, null];

    if (lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)) {
      const session: Session = {
        ip: geoIp,
        location: {
          country: geoData.country || 'Unknown',
          region: geoData.region || 'Unknown',
          city: geoData.city || 'Unknown',
          lat,
          lon,
          isp: geoData.org || undefined,
          timezone: geoData.timezone || undefined,
          postal: geoData.postal || undefined,
          country_code: geoData.country || undefined,
          asn: geoData.org ? geoData.org.split(' ')[0] : undefined,
        },
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        isNew: knownSessions ? !knownSessions.includes(geoIp) : true,
        geolocated: true,
        isGeolocating: false,
      };
      // console.log(`Successfully created session for ${ip}`);
      return session;
    } else {
      console.warn(`No valid coordinates found for IP ${ip}`);
      return {
        ip: geoIp,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        isNew: knownSessions ? !knownSessions.includes(geoIp) : true,
        geolocated: true,
        isGeolocating: false,
      };
    }
  } catch (error) {
    console.error(`Failed to geolocate IP ${ip || 'local'}:`, error);
    return {
      ip: ip || 'local',
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      isNew: knownSessions ? ip ? !knownSessions.includes(ip) : false : true,
      geolocated: true,
      isGeolocating: false,
    };
  }
}

// Fetch with retry logic for rate limiting
export const fetchWithRetry = async (url: string, retries = 3, delay = 1000): Promise<Response> => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);

      if (response.status === 429) {
        console.warn(`Rate limit hit for ${url}, attempt ${i + 1}/${retries}`);
        if (i === retries - 1) {
          throw new Error('Rate limit exceeded after multiple attempts');
        }
        // Exponential backoff: 1s, 2s, 4s
        const waitTime = delay * Math.pow(2, i);
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} failed:`, error);
      if (i === retries - 1) {
        throw error;
      }
      // Wait before retry even for non-429 errors
      const waitTime = delay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error('Max retries exceeded');
};
