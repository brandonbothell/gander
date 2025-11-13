import React from 'react';
import { FiBell, FiBellOff, FiUsers, FiLogOut } from 'react-icons/fi';
import { type Stream, type StreamMask } from '../../../source/types/shared';

interface StreamControlsProps {
  shouldNotifyOnMotion: boolean;
  isLoadingMotionNotifications: boolean;
  setShouldNotifyOnMotion: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoadingMotionNotifications: React.Dispatch<React.SetStateAction<boolean>>;
  showMaskEditor: boolean;
  setShowMaskEditor: React.Dispatch<React.SetStateAction<boolean>>;
  onShowSessionMonitor?: () => void;
  showMobileLogout: boolean;
  isMobile: boolean;
  handleLogout: () => void;
  activeStream: Stream | null;
  setMasks: React.Dispatch<React.SetStateAction<StreamMask[]>>;
  authFetch: (url: string, options?: object) => Promise<Response>;
  API_BASE: string;
  pauseMaskPollingUntil: React.RefObject<number>;
}

const StreamControls: React.FC<StreamControlsProps> = ({
  shouldNotifyOnMotion,
  isLoadingMotionNotifications,
  setShouldNotifyOnMotion,
  setIsLoadingMotionNotifications,
  showMaskEditor,
  setShowMaskEditor,
  onShowSessionMonitor,
  showMobileLogout,
  isMobile,
  handleLogout,
  activeStream,
  setMasks,
  authFetch,
  API_BASE,
  pauseMaskPollingUntil,
}) => {
  // Add this state to track if recording bar was ever open
  const [hasRecordingBarBeenOpen, setHasRecordingBarBeenOpen] = React.useState(false);

  // Listen for recording bar state changes
  React.useEffect(() => {
    // Check if RecordingBar is open by looking for it in the DOM
    const recordingBar = document.querySelector('.recording-bar');
    if (recordingBar) {
      setHasRecordingBarBeenOpen(true);
    }
  }, []);

  // Calculate dynamic top position
  const getTopPosition = () => {
    const recordingBar = document.querySelector('.recording-bar');
    const isRecordingBarOpen = recordingBar && recordingBar.clientHeight > 0;

    if (isRecordingBarOpen) {
      return -44; // Normal position when recording bar is open
    } else if (hasRecordingBarBeenOpen) {
      return -44; // Maintain consistent position after recording bar has been used
    } else {
      return -44; // Default position
    }
  };

  const topPosition = getTopPosition();

  const handleAddMask = async () => {
    if (!activeStream) return;

    // Default mask size and position (centered, 160x90 on 320x180 stream)
    const defaultMask = {
      x: 60,
      y: 35,
      w: 40,
      h: 20,
      type: 'fixed'
    };
    // After any mask API update:
    pauseMaskPollingUntil.current = Date.now() + 1000; // Pause polling for 1 second
    authFetch(`${API_BASE}/api/masks/${activeStream.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mask: defaultMask }),
    }).then(async result => {
      if (!result.body) {
        console.error('Failed to create new mask');
        return;
      }
      // Parse the response and add the new mask
      let data;
      try {
        data = await result.json();
      } catch {
        console.error('Failed to parse mask creation response');
        return;
      }
      if (data && data.mask) {
        setMasks(prev => [...prev, data.mask]);
      }
    });
  };

  return (
    <>
      {/* Motion Notifications Button */}
      <button
        className="reload-btn"
        style={{
          position: 'absolute',
          top: topPosition,
          left: 0,
          zIndex: 2,
          minWidth: 56,
          borderRadius: 8,
          fontWeight: 600,
          fontSize: '1em',
          marginBottom: 12,
          padding: '8px 18px 5px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          color: shouldNotifyOnMotion ? '#fff' : '#ff6b6b', // White when on, red when off
          border: 'none',
          boxShadow: shouldNotifyOnMotion
            ? 'inset 0 -3px 0 0 #fff'
            : 'inset 0 -3px 0 0 #ff6b6b', // White underline when on, red when off
          transition: 'color 0.2s',
          opacity: isLoadingMotionNotifications ? 0.6 : 1,
          cursor: isLoadingMotionNotifications ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!isLoadingMotionNotifications) {
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
            e.currentTarget.style.color = '#1cf1d1';
          }
        }}
        onMouseLeave={(e) => {
          const color = shouldNotifyOnMotion ? '#fff' : '#ff6b6b';
          e.currentTarget.style.boxShadow = `inset 0 -3px 0 0 ${color}`;
          e.currentTarget.style.color = color;
        }}
        aria-label={shouldNotifyOnMotion ? "Disable Motion Notifications" : "Enable Motion Notifications"}
        onClick={() => {
          setIsLoadingMotionNotifications(true);
          setShouldNotifyOnMotion(v => !v)
        }}
        disabled={isLoadingMotionNotifications}
      >
        {shouldNotifyOnMotion ? (
          <FiBell size={22} color="currentColor" />
        ) : (
          <FiBellOff size={22} color="currentColor" />
        )}
      </button>

      {/* Active Sessions button - Desktop */}
      <div className='desktop-only'>
        {!showMaskEditor && (
          <button
            className="reload-btn"
            style={{
              position: 'absolute',
              top: topPosition,
              left: 72, // Position it next to the notifications button
              zIndex: 2,
              minWidth: 120,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '1em',
              padding: '8px 18px 5px 18px',
              background: 'transparent',
              color: '#fff',
              border: 'none',
              boxShadow: 'inset 0 -3px 0 0 #fff',
              transition: 'color 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
              e.currentTarget.style.color = '#1cf1d1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff';
              e.currentTarget.style.color = '#fff';
            }}
            onClick={() => onShowSessionMonitor?.()}
          >
            <FiUsers size={22} color="currentColor" />
            Sessions
          </button>
        )}
      </div>

      {/* Sessions button for mobile - only show when logout is NOT showing */}
      <div className='mobile-only'>
        {!showMaskEditor && !showMobileLogout && (
          <button
            className="reload-btn"
            style={{
              position: 'absolute',
              top: topPosition,
              left: 72,
              zIndex: 2,
              minWidth: 120,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '1em',
              padding: '8px 18px 5px 18px',
              background: 'transparent',
              color: '#fff',
              border: 'none',
              boxShadow: 'inset 0 -3px 0 0 #fff',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onClick={() => onShowSessionMonitor?.()}
          >
            <FiUsers size={22} color="currentColor" />
            Sessions
          </button>
        )}
      </div>

      {/* Logout button - show on desktop always, on mobile only when showMobileLogout is true */}
      {!showMaskEditor && (!isMobile || showMobileLogout) && (
        <button
          className="reload-btn"
          style={{
            position: 'absolute',
            top: topPosition,
            left: isMobile ? 72 : 228, // On mobile, take the Sessions button position
            zIndex: 2,
            minWidth: 100,
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '1em',
            padding: '8px 18px 5px 18px',
            background: 'transparent',
            color: '#ff6b6b', // Red color like disabled notifications
            border: 'none',
            boxShadow: 'inset 0 -3px 0 0 #ff6b6b', // Red underline
            transition: 'all 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            // Add fade-in animation for mobile
            opacity: isMobile && showMobileLogout ? 1 : (!isMobile ? 1 : 0),
            transform: isMobile && showMobileLogout ? 'translateY(0)' : (isMobile ? 'translateY(-10px)' : 'translateY(0)'),
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
            e.currentTarget.style.color = '#1cf1d1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #ff6b6b';
            e.currentTarget.style.color = '#ff6b6b';
          }}
          onClick={handleLogout}
          aria-label="Logout"
        >
          <FiLogOut size={22} color="currentColor" />
          Logout
        </button>
      )}

      {/* Mask Editor Controls - Add Mask Button */}
      {showMaskEditor && (
        <button
          className="reload-btn"
          style={{
            position: 'absolute',
            top: topPosition,
            right: 140,
            zIndex: 2,
            minWidth: 120,
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '1em',
            padding: '8px 18px 5px 18px',
            background: 'transparent',
            color: '#fff',
            border: 'none',
            boxShadow: 'inset 0 -3px 0 0 #fff',
            transition: 'color 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
            e.currentTarget.style.color = '#1cf1d1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff';
            e.currentTarget.style.color = '#fff';
          }}
          onClick={handleAddMask}
        >
          + Add Mask
        </button>
      )}

      {/* Edit Masks / Done Button */}
      <button
        className="reload-btn"
        style={{
          position: 'absolute',
          top: topPosition,
          right: 0,
          zIndex: 2,
          minWidth: 120,
          borderRadius: 8,
          fontWeight: 600,
          fontSize: '1em',
          padding: '8px 18px 5px 18px',
          background: 'transparent',
          color: '#fff',
          border: 'none',
          boxShadow: 'inset 0 -3px 0 0 #fff',
          transition: 'color 0.2s',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
          e.currentTarget.style.color = '#1cf1d1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff';
          e.currentTarget.style.color = '#fff';
        }}
        onClick={() => setShowMaskEditor(showMaskEditor => !showMaskEditor)}
      >
        {!showMaskEditor ? 'Edit Masks' : 'Done'}
        {!showMaskEditor ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginLeft: 6, display: 'inline-block', verticalAlign: 'middle' }}
            aria-hidden="true"
            focusable="false"
          >
            <path d="M15.232 5.232l-10 10V17h1.768l10-10-1.768-1.768zM17.414 3.414a2 2 0 0 0-2.828 0l-1.172 1.172 2.828 2.828 1.172-1.172a2 2 0 0 0 0-2.828z" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginLeft: 6, display: 'inline-block', verticalAlign: 'middle' }}
            aria-hidden="true"
            focusable="false"
          >
            <polyline points="5 11 9 15 15 7" />
          </svg>
        )}
      </button>
    </>
  );
};

export default StreamControls;
