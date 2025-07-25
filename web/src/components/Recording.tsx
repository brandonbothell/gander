import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, authFetch } from '../main';
import { useSignedUrl } from '../hooks/useSignedUrl';
import { FiPlay, FiPause, FiVolume2, FiVolumeX, FiMaximize } from 'react-icons/fi';

export type Recording = { streamId: string, filename: string };

interface RecordingProps {
  open: boolean;
  streamId: string;
  filename: string;
  onClose: () => void;
  cachedRecordings: Recording[];
  onNavigate: (filename: string) => void;
  setNicknames: React.Dispatch<React.SetStateAction<{
    [filename: string]: string;
  }>>;
  setAutoScrollUntilRef?: (until: number) => void;
  setOpeningRecording: (opening: boolean) => void;
}

function formatTimestamp(filename: string) {
  const match = filename.match(/motion_(.+)\.mp4/);
  if (!match) return filename;
  const iso = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
    (_m, h, m2, s, ms) => `T${h}:${m2}:${s}.${ms}Z`
  );
  const date = new Date(iso);
  return isNaN(date.getTime()) ? match[1] : date.toLocaleString();
}

export function Recording({
  open,
  streamId,
  filename,
  onClose,
  cachedRecordings,
  onNavigate,
  setNicknames,
  videoRef: externalVideoRef,
  setAutoScrollUntilRef,
  setOpeningRecording
}: RecordingProps & { videoRef?: React.RefObject<HTMLVideoElement | null> }) {
  const [nickname, setNickname] = useState('');
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = externalVideoRef || useRef<HTMLVideoElement>(null);
  // Controls fade-away logic
  const [isControlBarVisible, setIsControlBarVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);
  const isSeekingRef = useRef(isSeeking);

  const videoUrl = useSignedUrl(filename, 'video', streamId);
  const thumbUrl = useSignedUrl(filename.replace(/\.mp4$/, '.jpg'), 'thumbnail', streamId);

  useEffect(() => {
    isSeekingRef.current = isSeeking;
  }, [isSeeking]);

  const scheduleHide = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = window.setTimeout(() => {
      if (isSeekingRef.current) {
        // While seeking, keep controls visible and reschedule
        scheduleHide();
      } else {
        setIsControlBarVisible(false);
      }
    }, 3000);
  }, []);
  const handleShowControls = () => {
    setIsControlBarVisible(true);
    scheduleHide();
  };
  const handleExitFullscreen = () => {
    if (screen.orientation && (screen.orientation as any).lock) {
      (screen.orientation as any).lock('portrait').then(() => (screen.orientation as any).unlock().catch(() => { })).catch(() => { });
    }
  }

  // Add fullscreenchange event listener to video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onFullscreenChange() {
      // Check if fullscreen is exited
      if (
        !document.fullscreenElement &&
        !((document as any).webkitFullscreenElement) &&
        !((document as any).mozFullScreenElement) &&
        !((document as any).msFullscreenElement)
      ) {
        handleExitFullscreen();
      }
    }

    video.addEventListener('fullscreenchange', onFullscreenChange);
    video.addEventListener('webkitfullscreenchange', onFullscreenChange);
    video.addEventListener('mozfullscreenchange', onFullscreenChange);
    video.addEventListener('MSFullscreenChange', onFullscreenChange);

    return () => {
      video.removeEventListener('fullscreenchange', onFullscreenChange);
      video.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      video.removeEventListener('mozfullscreenchange', onFullscreenChange);
      video.removeEventListener('MSFullscreenChange', onFullscreenChange);
    };
  }, [videoRef]);

  // Sync video state for controls/seek bar
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const getElementHeight = () => video.getBoundingClientRect().height;
    const handlePlay = () => {
      setIsPaused(false);
      setVideoHeight(getElementHeight());
      if (open) handleShowControls();
    };
    const handlePause = () => {
      setIsPaused(true);
      setVideoHeight(getElementHeight());
    };
    const handleVolumeChange = () => {
      setIsMuted(video.muted);
      setVideoHeight(getElementHeight());
    };
    const update = () => {
      setCurrentTime(video.currentTime);
      setDuration(video.duration || 0);
      setVideoHeight(getElementHeight());
    };
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('volumechange', handleVolumeChange);
    video.addEventListener('timeupdate', update);
    video.addEventListener('durationchange', update);
    video.addEventListener('loadedmetadata', update);
    setIsPaused(video.paused);
    setIsMuted(video.muted);
    update();
    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('volumechange', handleVolumeChange);
      video.removeEventListener('timeupdate', update);
      video.removeEventListener('durationchange', update);
      video.removeEventListener('loadedmetadata', update);
    };
  }, [videoRef, filename]);

  // Control handlers
  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => { setTimeout(handlePlayPause, 100); });
    } else {
      video.pause();
    }
    handleShowControls();
  };
  const handleMuteToggle = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    handleShowControls();
  };
  const handleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.requestFullscreen) {
      video.requestFullscreen();
    } else if ((video as any).webkitRequestFullscreen) {
      (video as any).webkitRequestFullscreen();
    }
    if (screen.orientation && (screen.orientation as any).lock) {
      (screen.orientation as any).lock('landscape').catch(() => { });
    }
    handleShowControls();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const value = Number(e.target.value);
    setCurrentTime(value);
    video.currentTime = value;

    if (!isSeeking) setIsSeeking(true);
    if (!isPaused) {
      video.pause();
      setIsPaused(true);
    }
  };

  const handleSeekPointerDown = () => {
    const video = videoRef.current;
    if (!video) return;

    setIsSeeking(true);
    video.pause();
    setIsPaused(true);
  };

  const handleSeekPointerUp = () => {
    const video = videoRef.current;
    if (!video) return;
    setIsSeeking(false);
    video.play();
    setIsPaused(false);
    // When seeking ends, immediately reschedule hiding controls
    scheduleHide();
  };

  useEffect(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (!open && videoRef.current) {
      setAutoScrollUntilRef?.(Date.now() + 1000);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      videoRef.current.pause();
      videoRef.current.src = '';
    } else if (open && videoUrl && videoRef.current) {
      setAutoScrollUntilRef?.(Date.now() + 1000);
      setOpeningRecording(true);
      setTimeout(() => {
        setOpeningRecording(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 700); // match controls bar animation duration
      videoRef.current.src = videoUrl;
      videoRef.current.load();
      videoRef.current.play().catch(() => { videoRef.current!.play(); });
    }

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
    };
  }, [open, videoUrl, videoRef]);

  // Fetch nickname from server
  useEffect(() => {
    if (!filename) return;
    authFetch(`${API_BASE}/api/recordings/${streamId}/${encodeURIComponent(filename)}/nickname`)
      .then(res => res.json())
      .then(data => setNickname(data.nickname || ''))
      .catch(() => setNickname(''));
  }, [filename, streamId]);

  // Save nickname to server
  const saveNickname = (newName: string) => {
    setNickname(newName);
    authFetch(`${API_BASE}/api/recordings/${streamId}/${encodeURIComponent(filename)}/nickname`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: newName }),
    }).then(res => {
      if (!res.ok) {
        console.error('Failed to save nickname:', res.statusText);
        return setNickname(''); // Reset on error
      }
      setNicknames(prev => ({ ...prev, [filename]: newName })); // Update local nicknames cache
    })
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => { videoRef.current!.play(); });
    }
  }, [filename, videoUrl]);

  const idx = cachedRecordings.findIndex(r => r.filename === filename);
  const prev = idx > 0 ? cachedRecordings[idx - 1] : null;
  const next = idx >= 0 && idx < cachedRecordings.length - 1 ? cachedRecordings[idx + 1] : null;

  return (
    <div style={{
      width: '100%',
      maxWidth: 900,
      margin: '0 auto',
      padding: 0,
      background: 'transparent',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      position: 'relative',
    }}>
      {/* Video + Seek Bar Container */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 900,
        }}
      >
        {/* Invisible overlay for controls/seek bar fade logic */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: videoHeight || 0,
            zIndex: 10,
            background: 'transparent',
            cursor: isControlBarVisible ? 'auto' : 'none',
            borderRadius: '24px',
            pointerEvents: 'auto', // restore pointer events for overlay
          }}
          onMouseEnter={handleShowControls}
          onMouseMove={handleShowControls}
          onTouchStart={handleShowControls}
        />
        {/* Video */}
        <video
          ref={videoRef}
          src={videoUrl}
          controls={false}
          autoPlay
          playsInline
          poster={thumbUrl}
          muted
          style={{
            width: '100%',
            maxWidth: 900,
            background: '#000',
            borderRadius: 24,
            marginBottom: 0,
            marginTop: 0,
            boxShadow: '0 8px 32px 0 rgba(26,41,128,0.4), 0 1.5px 8px 0 #000',
            maxHeight: '60vh',
            display: 'block',
          }}
        />
        {/* Controls Bar */}
        <div
          style={{
            position: 'absolute',
            top: 18,
            left: 18,
            zIndex: 20,
            display: 'flex',
            gap: 12,
            background: 'rgba(0,0,0,0.6)',
            borderRadius: 12,
            padding: '8px 16px',
            boxShadow: '0 2px 8px #1a2980aa',
            opacity: isControlBarVisible ? 1 : 0,
            transition: 'opacity 0.3s',
            pointerEvents: isControlBarVisible ? 'auto' : 'none',
          }}
        >
          <button
            onClick={handlePlayPause}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: 8,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-label={isPaused ? 'Play' : 'Pause'}
          >
            {isPaused ? <FiPlay size={24} /> : <FiPause size={24} />}
          </button>
          <button
            onClick={handleMuteToggle}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: 8,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <FiVolumeX size={24} /> : <FiVolume2 size={24} />}
          </button>
          <button
            onClick={handleFullscreen}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: 8,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-label="Fullscreen"
          >
            <FiMaximize size={24} />
          </button>
        </div>
        {/* Seek Bar + Timestamp */}
        <div style={{
          width: '100%',
          maxWidth: 900,
          margin: '0 auto',
          marginTop: isControlBarVisible ? 12 : 0,
          marginBottom: isControlBarVisible ? 12 : 0,
          display: 'flex',
          alignItems: 'center',
          background: 'linear-gradient(180deg, transparent 60%, #232b4a 100%)',
          opacity: isControlBarVisible ? 1 : 0,
          height: isControlBarVisible ? 44 : 0, // 44px when visible, 0 when hidden
          padding: isControlBarVisible ? '8px 18px' : '0px 18px',
          boxSizing: 'border-box',
          borderRadius: 8,
          position: 'relative',
          overflow: 'hidden',
          transition: 'opacity 0.3s, height 0.5s cubic-bezier(.4,2,.6,1), padding 0.5s cubic-bezier(.4,2,.6,1), margin 0.5s cubic-bezier(.4,2,.6,1)',
        }}>
          <span style={{
            color: '#8ef',
            fontSize: '0.95em',
            fontFamily: 'Orbitron, Roboto, Arial, sans-serif',
            minWidth: 60,
            textAlign: 'left',
            marginRight: 12,
            transition: 'opacity 0.3s',
            opacity: isControlBarVisible ? 1 : 0,
          }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          {/* Overlay for seek bar input to allow pointer events only on input */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 11,
            }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={currentTime}
            onChange={handleSeek}
            onPointerDown={handleSeekPointerDown}
            onPointerUp={handleSeekPointerUp}
            style={{
              width: '100%',
              accentColor: '#1cf1d1',
              height: 4,
              paddingTop: 2,
              paddingBottom: 2,
              borderRadius: 2,
              background: '#232b4a',
              position: 'relative',
              zIndex: 12,
              pointerEvents: 'auto',
              transition: 'opacity 0.3s',
              opacity: isControlBarVisible ? 1 : 0,
            }}
            aria-label="Seek"
          />
          <span style={{
            marginLeft: 12,
            color: '#8ef',
            fontSize: '0.95em',
            fontFamily: 'Orbitron, Roboto, Arial, sans-serif',
            minWidth: 60,
            textAlign: 'right',
            transition: 'opacity 0.3s',
            opacity: isControlBarVisible ? 1 : 0,
          }}>
            {formatTimestamp(filename)}
          </span>
        </div>
      </div>
      {/* Close Button - themed like StreamControlBar */}
      <button
        aria-label="Close"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 18,
          right: 18,
          zIndex: 10,
          background: 'rgba(0,0,0,0.6)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          cursor: 'pointer',
          transition: 'background 0.2s',
          boxShadow: '0 2px 8px #1a2980aa',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.5)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.6)'}
      >
        ×
      </button>
      {/* Nickname section */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: isControlBarVisible ? 0 : 8,
          marginBottom: 8,
          minHeight: 36,
          justifyContent: 'center',
          background: 'rgba(35,43,74,0.92)',
          borderRadius: 10,
          padding: '6px 18px',
          boxShadow: '0 2px 8px #1a2980aa',
          border: '1.5px solid #1976d2',
          fontFamily: "'Orbitron', 'Roboto', Arial, sans-serif",
          position: 'relative',
          transition: 'padding-right 0.3s cubic-bezier(.4,2,.6,1)',
          paddingRight: hover ? 22 : 6,
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {editing ? (
          <form
            onSubmit={e => {
              e.preventDefault();
              setEditing(false);
              saveNickname(nickname.trim());
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <input
              ref={inputRef}
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              onBlur={() => {
                setEditing(false);
                saveNickname(nickname.trim());
              }}
              style={{
                fontSize: '1.1em',
                padding: '4px 12px',
                borderRadius: 8,
                border: '1.5px solid #1976d2',
                minWidth: 140,
                background: '#fff',
                color: '#232b4a',
                fontFamily: "'Roboto', Arial, sans-serif",
              }}
              maxLength={64}
            />
            <button
              type="submit"
              style={{
                background: '#1976d2',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '4px 16px',
                cursor: 'pointer',
                fontSize: '1em',
                fontWeight: 600,
                fontFamily: "'Orbitron', 'Roboto', Arial, sans-serif",
                boxShadow: '0 1px 4px #1a298055',
              }}
            >
              Save
            </button>
          </form>
        ) : (
          <>
            <span
              style={{
                fontSize: '1.1em',
                fontWeight: nickname ? 700 : 400,
                fontStyle: nickname ? 'normal' : 'italic',
                color: nickname ? '#8ef' : '#ffb',
                minWidth: 140,
                maxWidth: 320,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'inline-block',
                letterSpacing: 0.2,
                fontFamily: "'Orbitron', 'Roboto', Arial, sans-serif",
                textShadow: nickname ? '0 1px 8px #1a2980' : 'none',
                cursor: 'pointer',
                userSelect: 'none'
              }}
              onClick={() => setEditing(true)}
              tabIndex={0}
              aria-label="Edit nickname"
              title="Click to edit nickname"
            >
              {nickname || 'Add a nickname'}
            </span>
            <span
              style={{
                cursor: 'pointer',
                opacity: hover ? 1 : 0,
                width: hover ? 22 : 0,
                marginLeft: 2,
                fontSize: '1.25em',
                transition: 'opacity 0.2s, width 0.3s cubic-bezier(.4,2,.6,1)',
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
              }}
              title="Edit nickname"
              onClick={() => setEditing(true)}
              tabIndex={0}
              aria-label="Edit nickname"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="#8ef">
                <path d="M14.7 3.29a1 1 0 0 1 1.41 0l.6.6a1 1 0 0 1 0 1.41l-9.1 9.1-2.12.7.7-2.12 9.1-9.1z"
                  stroke="#8ef" strokeWidth="1.5" fill="#8ef" />
              </svg>
            </span>
          </>
        )}
      </div>
      <div style={{ marginBottom: 16 }}>
        <span className="timestamp" style={{ fontSize: '1.2em' }}>
          {formatTimestamp(filename)}
        </span>
      </div>
      {/* Navigation */}
      <div className="recording-actions" style={{
        display: 'flex',
        marginBottom: 12,
        flexWrap: 'wrap',
        gap: '12px',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        maxWidth: '600px',
      }}>
        {prev && (
          <button
            onClick={() => onNavigate(prev.filename)}
            style={{
              background: 'transparent',
              color: '#fff',
              border: 'none',
              padding: '8px 16px 5px 16px',
              fontSize: '1.1em',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'color 0.2s',
              whiteSpace: 'nowrap',
              position: 'relative',
              boxShadow: 'inset 0 -3px 0 0 #fff',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
              e.currentTarget.style.color = '#1cf1d1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff';
              e.currentTarget.style.color = '#fff';
            }}
          >
            ← Previous
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            color: '#fff',
            border: 'none',
            padding: '8px 16px 5px 16px',
            fontSize: '1.1em',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'color 0.2s',
            whiteSpace: 'nowrap',
            position: 'relative',
            boxShadow: 'inset 0 -3px 0 0 #fff',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
            e.currentTarget.style.color = '#1cf1d1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff';
            e.currentTarget.style.color = '#fff';
          }}
        >
          Close
        </button>
        {next && (
          <button
            onClick={() => onNavigate(next.filename)}
            style={{
              background: 'transparent',
              marginBottom: window.innerWidth <= 600 ? 12 : 0,
              color: '#fff',
              border: 'none',
              padding: '8px 16px 5px 16px',
              fontSize: '1.1em',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'color 0.2s',
              whiteSpace: 'nowrap',
              position: 'relative',
              boxShadow: 'inset 0 -3px 0 0 #fff',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
              e.currentTarget.style.color = '#1cf1d1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff';
              e.currentTarget.style.color = '#fff';
            }}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

function formatTime(sec: number) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
