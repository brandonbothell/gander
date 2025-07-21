import { useEffect, useRef, useState } from 'react';
import { FiCircle, FiPause, FiPlay, FiX } from 'react-icons/fi';
import { type Stream } from '../../../types/shared'

interface StreamTilesGridProps {
  streams: Stream[];
  canAddStream: boolean;
  onAddStream: () => void;
  onEditNickname: (stream: Stream) => void;
  getThumbUrl: (stream: Stream) => string;
  setActiveStream: (stream: Stream) => void;
  onViewRecordings: (stream: Stream) => void;
  onToggleMotionPause: (stream: Stream, enabled: boolean) => Promise<void>;
  onDeleteStream?: (stream: Stream) => void; // Add this prop
  motionRecordingPaused: { [streamId: string]: boolean };
  motionStatus: { [streamId: string]: { recording: boolean; secondsLeft: number; saving: boolean; startedRecordingAt: number } };
  motionSaving: { [streamId: string]: boolean };
  activeStreamId?: string;
}

export function StreamTilesGrid({
  streams,
  canAddStream,
  onAddStream,
  onEditNickname,
  getThumbUrl,
  setActiveStream,
  onViewRecordings,
  onToggleMotionPause,
  onDeleteStream,
  motionRecordingPaused,
  motionStatus,
  motionSaving,
  activeStreamId
}: StreamTilesGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const lastActiveStreamIdRef = useRef<string | undefined>(activeStreamId);
  const animationTimeoutRef = useRef<number | null>(null);
  const [deletingStreamId, setDeletingStreamId] = useState<string | null>(null);
  const [isUpdatingMotionPaused, setIsUpdatingMotionPaused] = useState(false);

  // Capture positions and animate when active stream changes
  useEffect(() => {
    if (!gridRef.current || !activeStreamId) return;

    // Check if active stream actually changed
    if (lastActiveStreamIdRef.current === activeStreamId) return;

    // Only animate if we have a previous active stream (not initial load)
    if (!lastActiveStreamIdRef.current) {
      lastActiveStreamIdRef.current = activeStreamId;
      return;
    }

    console.log('Active stream changed:', lastActiveStreamIdRef.current, '->', activeStreamId);

    // Clear any existing animation timeout
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }

    // Capture current positions before React reorders
    const tiles = gridRef.current.querySelectorAll('.stream-tile-button');
    const currentPositions = new Map<string, DOMRect>();

    tiles.forEach((tile) => {
      const streamId = tile.getAttribute('data-stream-id');
      if (streamId) {
        currentPositions.set(streamId, tile.getBoundingClientRect());
      }
    });

    // Use longer delay for Android WebView to ensure DOM is ready
    const delay = navigator.userAgent.includes('Android') ? 100 : 32;

    animationTimeoutRef.current = window.setTimeout(() => {
      if (!gridRef.current) return;

      const newTiles = gridRef.current.querySelectorAll('.stream-tile-button');
      const animations: Animation[] = [];

      newTiles.forEach((tile) => {
        const streamId = tile.getAttribute('data-stream-id');
        if (!streamId) return;

        const oldRect = currentPositions.get(streamId);
        const newRect = tile.getBoundingClientRect();

        if (oldRect && newRect) {
          const deltaX = oldRect.left - newRect.left;
          const deltaY = oldRect.top - newRect.top;

          // Only animate if position actually changed significantly
          if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
            console.log(`Animating ${streamId}: ${deltaX}px, ${deltaY}px`);

            // Check if Web Animations API is supported
            if (tile.animate) {
              try {
                const animation = tile.animate([
                  {
                    transform: `translate(${deltaX}px, ${deltaY}px)`,
                    zIndex: '10'
                  },
                  {
                    transform: 'translate(0, 0)',
                    zIndex: '1'
                  }
                ], {
                  duration: 800,
                  easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  fill: 'both'
                });

                animations.push(animation);

                // Clean up animation when it finishes
                animation.addEventListener('finish', () => {
                  animation.cancel();
                });
              } catch (error) {
                console.warn('Web Animations API failed, falling back to CSS:', error);
                // Fallback to CSS transitions for Android WebView
                fallbackCSSAnimation(tile as HTMLElement, deltaX, deltaY);
              }
            } else {
              // Fallback for browsers without Web Animations API
              console.log('Web Animations API not supported, using CSS fallback');
              fallbackCSSAnimation(tile as HTMLElement, deltaX, deltaY);
            }
          }
        }
      });

      console.log(`Started ${animations.length} animations`);
    }, delay);

    lastActiveStreamIdRef.current = activeStreamId;

    // Cleanup function
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
    };
  }, [activeStreamId]);

  // CSS-based animation fallback for Android WebView
  const fallbackCSSAnimation = (element: HTMLElement, deltaX: number, deltaY: number) => {
    // Set initial position
    element.style.transition = 'none';
    element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    element.style.zIndex = '10';

    // Force reflow
    element.offsetHeight;

    // Animate to final position
    element.style.transition = 'transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    element.style.transform = 'translate(0, 0)';

    // Clean up after animation
    setTimeout(() => {
      element.style.transition = '';
      element.style.transform = '';
      element.style.zIndex = '';
    }, 800);
  };

  return (
    <div className="stream-tiles-grid" ref={gridRef}>
      {streams.map(stream => (
        <button
          key={stream.id}
          className="stream-tile-button"
          data-stream-id={stream.id}
          onClick={() => setActiveStream(stream)}
          style={{
            // Ensure hardware acceleration is enabled for better mobile performance
            willChange: 'transform',
            backfaceVisibility: 'hidden',
          }}
        >
          <div className="stream-tile">
            {/* Recording dot in top right if motionActive */}
            {motionSaving[stream.id] ? (
              <div className="motion-saving-indicator">
                <div className="spinner" style={{
                  position: 'absolute',
                  bottom: 10,
                  right: 10,
                  zIndex: 3,
                  width: 16, height: 16,
                  border: '2px solid rgba(255, 193, 7, 0.3)',
                  borderTop: '2px solid #ffc107',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  verticalAlign: 'middle',
                }} />
                <span style={{
                  position: 'absolute',
                  bottom: 10,
                  right: 26,
                  paddingRight: '8px',
                  zIndex: 3,
                  fontSize: '.8em',
                  verticalAlign: 'middle',
                }}>Saving</span>
              </div>
            ) : motionStatus[stream.id]?.recording ? (
              <>
                <span style={{
                  paddingRight: '8px',
                  position: 'absolute',
                  bottom: 10,
                  right: 26,
                  zIndex: 3,
                }}>
                  {motionStatus[stream.id]?.secondsLeft ? `${motionStatus[stream.id].secondsLeft}s` : ''}
                </span>
                <div
                  className="stream-tile-recording-dot"
                  style={{
                    position: 'absolute',
                    bottom: 10,
                    right: 10,
                    zIndex: 3,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: 'red',
                    boxShadow: '0 0 8px 2px #f00',
                    animation: 'record-blink 1s steps(1) infinite',
                    border: '2px solid #fff',
                  }}
                  title="Motion Recording"
                />
              </>
            ) : <></>}
            {/* Delete button - only show on active stream */}
            {stream.id === activeStreamId && onDeleteStream && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (window.confirm(`Are you sure you want to delete the stream "${stream.nickname || stream.id}"? This action cannot be undone.`)) {
                    setDeletingStreamId(stream.id);
                    onDeleteStream(stream);
                  }
                }}
                disabled={deletingStreamId === stream.id}
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  zIndex: 4,
                  background: 'transparent',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px 5px 16px',
                  fontSize: '1em',
                  fontWeight: 'bold',
                  cursor: deletingStreamId === stream.id ? 'not-allowed' : 'pointer',
                  transition: 'color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  opacity: deletingStreamId === stream.id ? 0.6 : 1,
                  boxShadow: 'inset 0 -3px 0 0 #fff',
                }}
                onMouseEnter={(e) => {
                  if (deletingStreamId !== stream.id) {
                    e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1';
                    e.currentTarget.style.color = '#1cf1d1';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff';
                  e.currentTarget.style.color = '#fff';
                }}
                title="Delete stream"
              >
                {deletingStreamId === stream.id ? (
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      border: '2px solid rgba(255, 255, 255, 0.3)',
                      borderTop: '2px solid #fff',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      marginRight: 6,
                    }}
                  />
                ) : (
                  <FiX style={{ marginRight: 6 }} size={18} />
                )}
                Delete Stream
              </button>
            )}
            <img
              src={getThumbUrl(stream)}
              alt={stream.nickname || stream.id}
              className="stream-tile-thumb"
            />
            <div className="stream-tile-overlay" style={{
              padding: '1.5rem 1.2rem 1.2rem 1.2rem',
              background: 'linear-gradient(to bottom, rgba(20,30,60,0.1) 0%, rgba(20,30,60,0.5) 30%, rgba(20,30,60,0.85) 100%)',
            }}>
              <div className="stream-tile-title">{stream.nickname || stream.id}</div>
              <button
                onClick={e => {
                  e.stopPropagation();
                  onEditNickname(stream);
                }}
                style={{
                  background: 'transparent',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px 5px 16px',
                  fontSize: '1em',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  marginRight: '0.5em',
                  marginTop: '0.8em',
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
                  style={{ marginRight: 6, display: 'inline-block', verticalAlign: 'middle' }}
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M15.232 5.232l-10 10V17h1.768l10-10-1.768-1.768zM17.414 3.414a2 2 0 0 0-2.828 0l-1.172 1.172 2.828 2.828 1.172-1.172a2 2 0 0 0 0-2.828z" />
                </svg>
                Edit Nickname
              </button>
              <button
                onClick={e => {
                  e.stopPropagation();
                  onViewRecordings(stream);
                  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                }}
                style={{
                  background: 'transparent',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px 5px 16px',
                  fontSize: '1em',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: '8px',
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
                <FiCircle style={{ marginRight: 8, fill: 'currentColor' }} />
                Recordings
              </button>
              <button
                onClick={e => {
                  e.stopPropagation();
                  setIsUpdatingMotionPaused(true);
                  onToggleMotionPause(stream, motionRecordingPaused[stream.id]).then(() => setIsUpdatingMotionPaused(false));
                }}
                disabled={isUpdatingMotionPaused}
                style={{
                  background: 'transparent',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px 5px 16px',
                  fontSize: '1em',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: '8px',
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
                aria-pressed={motionRecordingPaused[stream.id]}
              >
                {motionRecordingPaused[stream.id] ? (
                  <>
                    <FiPlay style={{ marginRight: 6 }} /> Start Motion Detection
                  </>
                ) : (
                  <>
                    <FiPause style={{ marginRight: 6 }} /> Stop Motion Detection
                  </>
                )}
              </button>
            </div>
          </div>
        </button>
      ))}
      {canAddStream && (
        <button
          onClick={onAddStream}
          className="flex items-center justify-center h-full w-full border-dashed border-2 border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <span className="text-gray-500">+ Add Stream</span>
        </button>
      )}
    </div>
  );
}
