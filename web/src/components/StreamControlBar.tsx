import React, { useEffect, useState, useRef } from 'react';
import { FiPlay, FiPause, FiVolume2, FiVolumeX, FiMaximize } from 'react-icons/fi';
import { type Stream } from '../../../source/types/shared'

interface StreamControlBarProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  activeStream: Stream | null;
}

export function StreamControlBar({
  videoRef,
  activeStream,
}: StreamControlBarProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [videoRect, setVideoRect] = useState<{ width: number; height: number; top: number; left: number } | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const lastActiveStreamRef = useRef(activeStream);

  // Calculate responsive sizes based on video dimensions
  const getResponsiveSizes = () => {
    if (!videoRect) return { barHeight: 80, iconSize: 24, padding: 20, gap: 20, buttonPadding: 8 };

    const videoWidth = videoRect.width;
    const videoHeight = videoRect.height;

    // Define breakpoints based on video size
    if (videoWidth < 400 || videoHeight < 300) {
      // Very small video
      return {
        barHeight: 60,
        iconSize: 18,
        padding: 12,
        gap: 12,
        buttonPadding: 6,
        controlPadding: '8px 12px',
        borderRadius: '8px'
      };
    } else if (videoWidth < 600 || videoHeight < 400) {
      // Small video
      return {
        barHeight: 70,
        iconSize: 20,
        padding: 16,
        gap: 16,
        buttonPadding: 7,
        controlPadding: '10px 16px',
        borderRadius: '10px'
      };
    } else {
      // Normal/large video
      return {
        barHeight: 80,
        iconSize: 24,
        padding: 20,
        gap: 20,
        buttonPadding: 8,
        controlPadding: '12px 20px',
        borderRadius: '12px'
      };
    }
  };

  const sizes = getResponsiveSizes();

  // Track video element position and size
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateVideoRect = () => {
      const wrapper = video.parentElement;
      if (!wrapper) return;

      const videoRect = video.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();

      setVideoRect({
        width: video.offsetWidth, // Use offsetWidth/Height for exact dimensions
        height: video.offsetHeight,
        top: videoRect.top - wrapperRect.top,
        left: videoRect.left - wrapperRect.left,
      });
    };

    // Initial update
    updateVideoRect();

    // Listen for video load and resize events
    video.addEventListener('loadedmetadata', updateVideoRect);

    // Use ResizeObserver for more accurate tracking
    let resizeObserver: ResizeObserver | null = null;
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(updateVideoRect);
      resizeObserver.observe(video);
    }

    // Also update on window resize
    window.addEventListener('resize', updateVideoRect);

    return () => {
      video.removeEventListener('loadedmetadata', updateVideoRect);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', updateVideoRect);
    };
  }, [videoRef, activeStream]);

  // Show controls when activeStream changes
  useEffect(() => {
    if (activeStream && activeStream !== lastActiveStreamRef.current) {
      setIsVisible(true);
      scheduleHide();
      lastActiveStreamRef.current = activeStream;
    }
  }, [activeStream]);

  // Ensure video starts muted
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = true;
      setIsMuted(true);
    }
  }, [videoRef, activeStream]);

  // Listen for video events to sync state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPaused(false);
    const handlePause = () => setIsPaused(true);
    const handleVolumeChange = () => setIsMuted(video.muted);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('volumechange', handleVolumeChange);

    // Set initial state
    setIsPaused(video.paused);
    setIsMuted(video.muted);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [videoRef, activeStream]);

  const scheduleHide = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = window.setTimeout(() => {
      setIsVisible(false);
    }, 3000);
  };

  const handleShowControls = () => {
    setIsVisible(true);
    scheduleHide();
  };

  const handleMouseEnter = () => {
    if (!window.ontouchstart) {
      handleShowControls();
    }
  };

  const handleMouseMove = () => {
    if (!window.ontouchstart) {
      handleShowControls();
    }
  };

  const handleTouchStart = () => {
    handleShowControls();
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => { });
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
    // Only lock orientation if supported and not iOS PWA
    if (
      'orientation' in screen &&
      typeof (screen.orientation as any).lock === 'function' &&
      !(/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.userAgent.includes('Macintosh') && 'ontouchend' in document))
    ) {
      try {
        (screen.orientation as any).lock('landscape').catch(() => { });
      } catch (error) {
        // Ignore errors
      }
    }
    handleShowControls();
  };

  if (!activeStream || !videoRect) return null;

  return (
    <>
      {/* Invisible overlay - positioned exactly over the video element */}
      <div
        style={{
          position: 'absolute',
          top: `${videoRect.top}px`,
          left: `${videoRect.left}px`,
          width: `${videoRect.width}px`,
          height: `${videoRect.height}px`,
          zIndex: 1,
          background: 'transparent',
          cursor: isVisible ? 'auto' : 'none',
          borderRadius: '24px',
        }}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
      />

      {/* Control bar - positioned at the bottom of the actual video */}
      <div
        style={{
          position: 'absolute',
          bottom: `calc(${videoRect.top}px + 2rem + 8px)`,
          left: `${videoRect.left}px`,
          width: `${videoRect.width}px`,
          height: `${sizes.barHeight}px`, // Responsive height
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.7) 100%)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          padding: `0 ${sizes.padding}px ${sizes.padding}px`, // Responsive padding
          zIndex: 2,
          opacity: isVisible ? 1 : 0,
          transition: 'opacity 0.3s ease-in-out',
          pointerEvents: isVisible ? 'auto' : 'none',
          borderRadius: '0 0 24px 24px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: `${sizes.gap}px`, // Responsive gap
            background: 'rgba(0, 0, 0, 0.6)',
            borderRadius: sizes.borderRadius, // Responsive border radius
            padding: sizes.controlPadding, // Responsive padding
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          {/* Play/Pause Button */}
          <button
            onClick={handlePlayPause}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: `${sizes.buttonPadding}px`, // Responsive button padding
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            aria-label={isPaused ? 'Play' : 'Pause'}
          >
            {isPaused ? (
              <FiPlay size={sizes.iconSize} />
            ) : (
              <FiPause size={sizes.iconSize} />
            )}
          </button>

          {/* Mute/Unmute Button */}
          <button
            onClick={handleMuteToggle}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: `${sizes.buttonPadding}px`, // Responsive button padding
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <FiVolumeX size={sizes.iconSize} />
            ) : (
              <FiVolume2 size={sizes.iconSize} />
            )}
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
      </div>
    </>
  );
}
