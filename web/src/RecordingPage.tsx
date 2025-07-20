import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './RecordingPage.css';
import { API_BASE, authFetch } from './main';
import { useSignedUrl } from './hooks/useSignedUrl';
import { useLocalStorageState } from './hooks/useLocalStorageState';

export type Recording = { streamId: string, filename: string };

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

function RecordingPage() {
  const params = useParams();
  const navigate = useNavigate();
  const initialFilename = params.filename || '';
  const streamId = params.streamId || 'cam1';

  const [filename, setFilename] = useState(initialFilename);
  const [viewed, setViewed] = useState<{ filename: string, streamId: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('viewedRecordings') || '[]');
    } catch {
      return [];
    }
  });
  const [nickname, setNickname] = useState('');
  const [editing, setEditing] = useState(false);
  const [hover, setHover] = useState(false);
  const videoUrl = useSignedUrl(filename, 'video', streamId);
  const thumbUrl = useSignedUrl(filename.replace(/\.mp4$/, '.jpg'), 'thumbnail', streamId);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cachedRecordings, setCachedRecordings] = useLocalStorageState<{ [streamId: string]: Recording[] }>('cachedRecordings', {});
  const [totalRecordings, setTotalRecordings] = useLocalStorageState<{ [streamId: string]: number }>('totalRecordings', {});
  const PAGE_SIZE = 50;

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
    });
  };

  useEffect(() => {
    if (params.filename && params.filename !== filename) {
      setFilename(params.filename);
    }
  }, [params.filename]);

  const markViewed = useCallback(() => {
    if (filename && !viewed.find(r => r.filename === filename && r.streamId === streamId)) {
      const updated = [...viewed, { filename, streamId }];
      setViewed(updated);
      localStorage.setItem('viewedRecordings', JSON.stringify(updated));
    }
  }, [filename, streamId, viewed, setViewed]);

  // --- Mark recordings as viewed when they are opened ---
  useEffect(() => {
    // console.log('markViewed:', { filename, viewed, recordings, streamId });
    markViewed();
  }, [markViewed]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Ensure video reloads and plays when filename changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => { });
    }
  }, [filename, videoUrl]);

  async function fetchPageIfNeeded(streamId: string, page: number) {
    const cached = cachedRecordings[streamId] || [];
    // Only fetch if we don't already have all expected recordings
    if (cached.length >= (totalRecordings[streamId] || 0)) return;

    const res = await authFetch(`${API_BASE}/api/recordings/${streamId}?page=${page}&size=${PAGE_SIZE}`);
    if (!res.ok) return;

    const data = await res.json();
    const recs = data.recordings || data; // support both array and {recordings: []}
    setTotalRecordings(prev => ({ ...prev, [streamId]: data.total || prev[streamId] || 0 }));
    setCachedRecordings(prev => {
      const prevList = prev[streamId] || [];
      // Deduplicate by filename
      const all = [...prevList, ...recs];
      const seen = new Set<string>();
      const deduped = all.filter(r => {
        if (seen.has(r.filename)) return false;
        seen.add(r.filename);
        return true;
      });
      // Sort newest first (descending)
      deduped.sort((a, b) => b.filename.localeCompare(a.filename));
      return { ...prev, [streamId]: deduped };
    });
  }

  // Navigation effect: ensure next/prev are in cache if possible
  useEffect(() => {
    if (!filename) return;
    const cached = cachedRecordings[streamId] || [];
    let idx = cached.findIndex(r => r.filename === filename);

    // If not found, fetch first page
    if (idx === -1) {
      fetchPageIfNeeded(streamId, 1);
      return;
    }

    // Try to prefetch next/prev if they might exist but aren't cached yet
    const nextIdx = idx + 1;
    const prevIdx = idx - 1;
    // Only fetch next page if we haven't cached all recordings yet
    if (
      nextIdx >= cached.length &&
      cached.length < (totalRecordings[streamId] || Infinity)
    ) {
      const nextPage = Math.floor(nextIdx / PAGE_SIZE) + 1;
      fetchPageIfNeeded(streamId, nextPage);
    }
    if (prevIdx < 0 && idx > 0) {
      const prevPage = Math.floor(prevIdx / PAGE_SIZE) + 1;
      if (prevPage > 0) fetchPageIfNeeded(streamId, prevPage);
    }
  }, [filename, streamId, cachedRecordings, totalRecordings]);

  // When rendering, use the deduped, filtered cache:
  const cached = cachedRecordings[streamId] || [];
  const idx = cached.findIndex(r => r.filename === filename);
  const prev = idx > 0 ? cached[idx - 1] : null;
  const next =
    idx >= 0 && idx < cached.length - 1
      ? cached[idx + 1]
      : // If not in cache but totalRecordings says there should be more, show a loading state or trigger fetch
      null;

  if (idx === -1) {
    return <div>Loading recording info...</div>;
  }

  return (
    <div className="App">
      <h2>Recording</h2>
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
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        autoPlay
        playsInline
        poster={thumbUrl}
        style={{ width: '80vw', maxWidth: 900, background: '#000', borderRadius: 24 }}
        key={filename}
      />
      <div className="recording-actions">
        <div className="recording-nav-group">
          <button
            className="recording-link"
            onClick={() => {
              if (prev) navigate(`/recordings/${streamId}/${prev.filename}`);
            }}
            disabled={!prev}
            style={{ position: 'relative' }}
          >
            Previous
            {prev && !viewed.find(v => v.filename === prev.filename && v.streamId === prev.streamId) && (
              <span className="new-badge" style={{
                position: 'absolute',
                top: -8,
                right: -18,
                fontSize: '0.8em'
              }}>New</span>
            )}
          </button>
          <button className="recording-link" onClick={() => navigate('/', { state: { fromInternalNav: true } })}>
            Back to Stream
          </button>
          <button
            className="recording-link"
            onClick={() => {
              if (next) navigate(`/recordings/${streamId}/${next.filename}`);
            }}
            disabled={!next}
            style={{ position: 'relative' }}
          >
            Next
            {next && !viewed.find(v => v.filename === next.filename && v.streamId === next.streamId) && (
              <span className="new-badge" style={{
                position: 'absolute',
                top: -8,
                right: -18,
                fontSize: '0.8em'
              }}>New</span>
            )}
          </button>
        </div>
        <button
          className="recording-link recording-delete-btn"
          style={{ background: '#c00', color: '#fff', fontWeight: 'bold' }}
          onClick={async () => {
            if (!window.confirm('Delete this recording? This cannot be undone.')) return;
            await authFetch(`${API_BASE}/api/recordings/${streamId}/${encodeURIComponent(filename)}`, {
              method: 'DELETE',
            }); 5
            // Remove from cachedRecordings
            setCachedRecordings(prev => {
              const updated = (prev[streamId] || []).filter(r => r.filename !== filename);
              return { ...prev, [streamId]: updated.sort((a, b) => b.filename.localeCompare(a.filename)) };
            });
            navigate('/', {
              state: {
                scrollToRecordings: true,
                fromInternalNav: true,
                deletedFilename: filename, // Pass the deleted filename
              }
            });
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default RecordingPage;
