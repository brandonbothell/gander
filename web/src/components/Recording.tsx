import { useEffect, useRef, useState } from 'react';
import { API_BASE, authFetch } from '../main';
import { useSignedUrl } from '../hooks/useSignedUrl';

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
  setNicknames
}: RecordingProps) {
  const [nickname, setNickname] = useState('');
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const videoUrl = useSignedUrl(filename, 'video', streamId);
  const thumbUrl = useSignedUrl(filename.replace(/\.mp4$/, '.jpg'), 'thumbnail', streamId);

  useEffect(() => {
    if (!open && videoRef.current) {
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
      videoRef.current.pause();
      videoRef.current.src = '';
    } else if (open && videoUrl && videoRef.current) {
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
      videoRef.current.src = videoUrl;
      videoRef.current.load();
      videoRef.current.play().catch(() => { });
    }

    return () => {
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
      videoRef.current.play().catch(() => { });
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
    }}>
      {/* Video */}
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        autoPlay
        playsInline
        poster={thumbUrl}
        style={{
          width: '100%',
          maxWidth: 900,
          background: '#000',
          borderRadius: 24,
          marginBottom: 12,
          marginTop: 0,
          boxShadow: '0 8px 32px 0 rgba(26,41,128,0.4), 0 1.5px 8px 0 #000',
        }}
      />
      {/* Nickname section */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
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
