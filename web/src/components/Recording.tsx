import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE, authFetch } from '../main'
import { useSignedUrl } from '../hooks/useSignedUrl'
import {
  FiPlay,
  FiPause,
  FiVolume2,
  FiVolumeX,
  FiMaximize,
} from 'react-icons/fi'
import { Capacitor } from '@capacitor/core'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { formatTimestamp } from '../utils/format'

export type RecordingType = {
  streamId: string
  filename: string
  motionTimestamps: number[]
}

interface RecordingProps {
  open: boolean
  streamId: string
  filename: string
  motionTimestamps: number[]
  onClose: () => void
  cachedRecordings: RecordingType[]
  onNavigate: (filename: string, motionTimestamps: number[]) => void
  setNicknames: React.Dispatch<
    React.SetStateAction<{
      [filename: string]: string
    }>
  >
  setAutoScrollUntilRef?: (until: number) => void
  setOpeningRecording: (opening: boolean) => void
}

export function Recording({
  open,
  streamId,
  filename,
  motionTimestamps,
  onClose,
  cachedRecordings,
  onNavigate,
  setNicknames,
  videoRef: externalVideoRef,
  setAutoScrollUntilRef,
}: RecordingProps & { videoRef?: React.RefObject<HTMLVideoElement | null> }) {
  const [nickname, setNickname] = useState('')
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(externalVideoRef?.current || null)
  const seekbarRef = useRef<HTMLDivElement>(null)
  // Controls fade-away logic
  const [isControlBarVisible, setIsControlBarVisible] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const isPausedRef = useRef(isPaused)
  const [isMuted, setIsMuted] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [videoHeight, setVideoHeight] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const hideTimeoutRef = useRef<number | null>(null)
  const isSeekingRef = useRef(isSeeking)
  const filenameRef = useRef(filename)
  const lastFilenameRef = useRef(filename)
  const videoUrl = useSignedUrl(filename, 'video', streamId)
  const lastPlaybackTimeRef = useRef<number>(0)
  const thumbUrl = useSignedUrl(
    filename.replace(/\.mp4$/, '.jpg'),
    'thumbnail',
    streamId,
  )

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  useEffect(() => {
    isSeekingRef.current = isSeeking
  }, [isSeeking])

  useEffect(() => {
    lastFilenameRef.current = filenameRef.current
    filenameRef.current = filename
  }, [filename])

  const scheduleHide = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    hideTimeoutRef.current = window.setTimeout(() => {
      if (isSeekingRef.current) {
        // While seeking, keep controls visible and reschedule
        scheduleHide()
      } else {
        if (!isPausedRef.current) setIsControlBarVisible(false)
      }
    }, 3000)
  }, [])
  const handleShowControls = () => {
    setIsControlBarVisible(true)
    scheduleHide()
  }

  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes('Macintosh') && 'ontouchend' in document)
    )
  }

  const handleFullscreen = () => {
    const video = videoRef.current
    if (!video) return
    if (
      isIOS() &&
      typeof (video as typeof video & { webkitEnterFullscreen: () => void })
        .webkitEnterFullscreen === 'function'
    ) {
      // iOS Safari/PWA: use webkitEnterFullscreen
      ;(
        video as typeof video & { webkitEnterFullscreen: () => void }
      ).webkitEnterFullscreen()
    } else if (video.requestFullscreen) {
      video.requestFullscreen()
    } else if (
      (video as typeof video & { webkitRequestFullscreen: () => void })
        .webkitRequestFullscreen
    ) {
      ;(
        video as typeof video & { webkitRequestFullscreen: () => void }
      ).webkitRequestFullscreen()
    }
    if (Capacitor.isNativePlatform()) {
      ScreenOrientation.lock({ orientation: 'landscape' })
    } else if (
      'orientation' in screen &&
      typeof (
        screen.orientation as typeof screen.orientation & {
          lock: (orientation: string) => Promise<void>
        }
      ).lock === 'function'
    ) {
      try {
        ;(
          screen.orientation as typeof screen.orientation & {
            lock: (orientation: string) => Promise<void>
          }
        )
          .lock('landscape')
          .catch()
      } catch (_) {
        // Ignore errors
      }
    }
    handleShowControls()
  }
  const handleExitFullscreen = () => {
    if (Capacitor.isNativePlatform()) {
      ScreenOrientation.unlock()
    } else if (
      screen.orientation &&
      typeof screen.orientation.unlock === 'function'
    ) {
      try {
        const result = screen.orientation.unlock() as unknown
        if (
          result &&
          typeof result === 'object' &&
          'catch' in result &&
          typeof result.catch === 'function'
        ) {
          result.catch(() => console.warn('Failed to exit fullscreen'))
        }
      } catch (error) {
        console.error('Failed to exit fullscreen orientation lock:', error)
      }
    }
  }

  // Add fullscreenchange event listener to video
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function onFullscreenChange() {
      console.warn('Fullscreen change detected:')
      // Check if fullscreen is exited
      if (
        !document.fullscreenElement &&
        !(
          document as typeof document & {
            webkitFullscreenElement: Element | null
          }
        ).webkitFullscreenElement &&
        !(
          document as typeof document & { mozFullScreenElement: Element | null }
        ).mozFullScreenElement &&
        !(document as typeof document & { msFullscreenElement: Element | null })
          .msFullscreenElement
      ) {
        handleExitFullscreen()
      }
    }

    video.addEventListener('fullscreenchange', onFullscreenChange)
    video.addEventListener('webkitfullscreenchange', onFullscreenChange)
    video.addEventListener('mozfullscreenchange', onFullscreenChange)
    video.addEventListener('MSFullscreenChange', onFullscreenChange)

    return () => {
      video.removeEventListener('fullscreenchange', onFullscreenChange)
      video.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      video.removeEventListener('mozfullscreenchange', onFullscreenChange)
      video.removeEventListener('MSFullscreenChange', onFullscreenChange)
    }
  }, [videoRef])

  // Sync video state for controls/seek bar
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const getElementHeight = () => video.getBoundingClientRect().height
    const handlePlay = () => {
      setIsPaused(false)
      setVideoHeight(getElementHeight())
      if (!isControlBarVisible) handleShowControls()
      else scheduleHide()
    }
    const handlePause = () => {
      setIsPaused(true)
      setVideoHeight(getElementHeight())
    }
    const handleVolumeChange = () => {
      setIsMuted(video.muted)
      setVideoHeight(getElementHeight())
    }
    const update = () => {
      setCurrentTime(video.currentTime)
      setDuration(video.duration || 0)
      setVideoHeight(getElementHeight())
    }
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('volumechange', handleVolumeChange)
    video.addEventListener('timeupdate', update)
    video.addEventListener('durationchange', update)
    video.addEventListener('loadedmetadata', update)
    setIsPaused(video.paused)
    setIsMuted(video.muted)
    update()
    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('volumechange', handleVolumeChange)
      video.removeEventListener('timeupdate', update)
      video.removeEventListener('durationchange', update)
      video.removeEventListener('loadedmetadata', update)
    }
  }, [videoRef, filename])

  // Control handlers
  const handlePlayPause = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().catch(() => {
        setTimeout(handlePlayPause, 100)
      })
    } else {
      video.pause()
    }
    handleShowControls()
  }
  const handleMuteToggle = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
    handleShowControls()
  }

  const handleCustomSeek = (e: React.PointerEvent | React.MouseEvent) => {
    const video = videoRef.current
    const seekbar = seekbarRef.current
    if (!video || !seekbar) return

    const rect = seekbar.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    const newTime = percentage * duration

    if (!isSeeking) setIsSeeking(true)
    setCurrentTime(newTime)
    video.currentTime = newTime
    setIsSeeking(false)
  }

  const handleSeekPointerDown = (e: React.PointerEvent) => {
    handleCustomSeek(e) // Seek immediately on click
    setIsSeeking(true)
    videoRef.current?.pause()
    setIsPaused(true)
  }

  const handleSeekPointerUp = () => {
    const video = videoRef.current
    if (!video) return
    setIsSeeking(false)
    video.play()
    setIsPaused(false)
    // When seeking ends, immediately reschedule hiding controls
    scheduleHide()
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => {
      // Only update playback time if not reset by reload
      if (video.currentTime !== 0 || isSeekingRef.current) {
        lastPlaybackTimeRef.current = video.currentTime
      }
    }

    video.addEventListener('timeupdate', handleTimeUpdate)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) return

    // Restore playback position after video loads new URL
    const handleLoaded = () => {
      console.log(
        'Video loaded:',
        video.src,
        'Last playback position:',
        lastPlaybackTimeRef.current + 's',
        'Video duration:',
        video.duration + 's',
      )
      if (
        lastPlaybackTimeRef.current > 0 &&
        video.duration > lastPlaybackTimeRef.current
      ) {
        video.currentTime = lastPlaybackTimeRef.current
      }
      // Optionally play if not paused
      if (!video.paused) {
        video.play().catch(() => console.warn('Failed to play stream'))
      }
    }

    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    if (!open && videoRef.current) {
      setAutoScrollUntilRef?.(Date.now() + 1000)
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 450)
      videoRef.current.pause()
      videoRef.current.src = ''
    } else if (open && videoUrl && videoRef.current) {
      console.log(
        `Recording opened. Motion timestamps: ${JSON.stringify(motionTimestamps)}`,
      )
      videoRef.current.src = videoUrl
      videoRef.current.load()

      if (filenameRef.current !== lastFilenameRef.current) {
        videoRef.current.play().catch(() => {
          setTimeout(() => videoRef.current?.play(), 1000)
        })
      } else {
        videoRef.current.addEventListener('loadedmetadata', handleLoaded)
      }
    }

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.src = ''
      }
      video.removeEventListener('loadedmetadata', handleLoaded)
    }
  }, [open, videoUrl, videoRef, filenameRef])

  // Fetch nickname from server
  useEffect(() => {
    if (!filename) return
    authFetch(
      `${API_BASE}/api/recordings/${streamId}/${encodeURIComponent(filename)}/nickname`,
    )
      .then((res) => res.json())
      .then((data) => setNickname(data.nickname || ''))
      .catch(() => setNickname(''))
  }, [filename, streamId])

  useEffect(() => {
    if (!isSeeking) return

    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      if (!seekbarRef.current || !videoRef.current || duration === 0) return
      const rect = seekbarRef.current.getBoundingClientRect()
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const x = clientX - rect.left
      const percentage = Math.max(0, Math.min(1, x / rect.width))

      const newTime = percentage * duration
      setCurrentTime(newTime)
      videoRef.current.currentTime = newTime
    }

    const handleGlobalUp = () => {
      setIsSeeking(false)
      videoRef.current?.play()
      setIsPaused(false)
      scheduleHide()
    }

    window.addEventListener('mousemove', handleGlobalMove)
    window.addEventListener('touchmove', handleGlobalMove)
    window.addEventListener('mouseup', handleGlobalUp)
    window.addEventListener('touchend', handleGlobalUp)

    return () => {
      window.removeEventListener('mousemove', handleGlobalMove)
      window.removeEventListener('touchmove', handleGlobalMove)
      window.removeEventListener('mouseup', handleGlobalUp)
      window.removeEventListener('touchend', handleGlobalUp)
    }
  }, [isSeeking, duration])

  // Save nickname to server
  const saveNickname = (newName: string) => {
    setNickname(newName)
    authFetch(
      `${API_BASE}/api/recordings/${streamId}/${encodeURIComponent(filename)}/nickname`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: newName }),
      },
    ).then((res) => {
      if (!res.ok) {
        console.error('Failed to save nickname:', res.statusText)
        return setNickname('') // Reset on error
      }
      setNicknames((prev) => ({ ...prev, [filename]: newName })) // Update local nicknames cache
    })
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const idx = cachedRecordings.findIndex((r) => r.filename === filename)
  const prev = idx > 0 ? cachedRecordings[idx - 1] : null
  const next =
    idx >= 0 && idx < cachedRecordings.length - 1
      ? cachedRecordings[idx + 1]
      : null

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 900,
        margin: '0 auto',
        padding: 0,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
      }}
    >
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
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'transparent')
            }
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
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'transparent')
            }
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
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'transparent')
            }
            aria-label="Fullscreen"
          >
            <FiMaximize size={24} />
          </button>
        </div>
        {/* Seek Bar + Timestamp */}
        <div
          style={{
            width: '100%',
            maxWidth: 900,
            margin: '0 auto',
            marginTop: isControlBarVisible ? 12 : 0,
            marginBottom: isControlBarVisible ? 12 : 0,
            display: 'flex',
            alignItems: 'center',
            background:
              'linear-gradient(180deg, transparent 60%, #232b4a 100%)',
            opacity: isControlBarVisible ? 1 : 0,
            height: isControlBarVisible ? 44 : 0,
            padding: isControlBarVisible ? '8px 18px' : '0px 18px',
            boxSizing: 'border-box',
            borderRadius: 8,
            position: 'relative',
            overflow: 'hidden',
            transition:
              'opacity 0.3s, height 0.5s cubic-bezier(.4,2,.6,1), padding 0.5s cubic-bezier(.4,2,.6,1), margin 0.5s cubic-bezier(.4,2,.6,1)',
          }}
        >
          <span
            style={{
              color: '#8ef',
              fontSize: '0.95em',
              fontFamily: 'Orbitron, Roboto, Arial, sans-serif',
              minWidth: 60,
              textAlign: 'left',
              marginRight: 12,
              transition: 'opacity 0.3s',
              opacity: isControlBarVisible ? 1 : 0,
            }}
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Custom Seek Bar Container */}
          <div
            ref={seekbarRef}
            onPointerDown={handleSeekPointerDown}
            onPointerUp={handleSeekPointerUp}
            style={{
              position: 'relative',
              flex: 1,
              height: 8,
              paddingTop: 2,
              paddingBottom: 2,
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              touchAction: 'none', // Prevents scrolling while seeking
            }}
          >
            {/* 1. Background Track */}
            <div
              style={{
                width: '100%',
                height: 4,
                background: '#dddddd',
                borderRadius: 2,
                position: 'absolute',
                zIndex: 10,
              }}
            />

            {/* 2. Motion Dots (Middle Layer) */}
            {isControlBarVisible &&
              duration > 0 &&
              motionTimestamps
                .reduce((acc: number[][], ms: number) => {
                  const timeSec = ms / 1000
                  const lastGroup = acc[acc.length - 1]
                  if (
                    lastGroup &&
                    timeSec - lastGroup[lastGroup.length - 1] <= 5
                  ) {
                    lastGroup.push(timeSec)
                  } else {
                    acc.push([timeSec])
                  }
                  return acc
                }, [])
                .map((group, idx) => {
                  const startSec = group[0]
                  const endSec = group[group.length - 1]
                  const left = (startSec / duration) * 100
                  const width = ((endSec - startSec) / duration) * 100

                  return (
                    <div
                      key={idx}
                      onPointerDown={(e) => {
                        if (!isSeeking) e.stopPropagation()
                      }}
                      onClick={(e) => {
                        // If we're scrubbing, don't let the dot click interrupt
                        if (isSeeking) return

                        e.stopPropagation()
                        if (videoRef.current) {
                          setCurrentTime(startSec)
                          videoRef.current.currentTime = startSec
                        }
                      }}
                      style={{
                        position: 'absolute',
                        left: `${left}%`,
                        width: width > 0 ? `${width}%` : 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: '#1cf1d1',
                        paddingBottom: 2,
                        zIndex: 15,
                        border: '1px solid #1a1f35',
                        boxShadow: '0 0 6px rgba(28, 241, 209, 0.9)',
                        pointerEvents: isSeeking ? 'none' : 'auto', // Prevent dots from "stealing" mouse focus during a drag
                        transform:
                          width > 0
                            ? 'translateY(-50%)'
                            : 'translate(-50%, -50%)',
                        top: '50%',
                      }}
                    />
                  )
                })}

            {/* 3. The Draggable Thumb (Top Layer) */}
            <div
              onPointerDown={(e) => {
                // 1. Prevent the dot underneath from seeing the click
                e.stopPropagation()
                // 2. Start the normal scrubbing logic
                handleSeekPointerDown(e)
              }}
              style={{
                position: 'absolute',
                left: `${(currentTime / duration) * 100}%`,
                width: 16,
                height: 16,
                backgroundColor: '#1cf1d1',
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
                top: '50%',
                zIndex: 30, // Higher than the dots (25)
                boxShadow: isSeeking
                  ? '0 0 15px #1cf1d1'
                  : '0 0 8px rgba(28, 241, 209, 0.8)',
                cursor: 'pointer',
                pointerEvents: 'auto', // Now it's a solid hit-target
                transition: 'width 0.1s, height 0.1s',
              }}
            />
          </div>
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
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = 'rgba(0,0,0,0.5)')
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = 'rgba(0,0,0,0.6)')
        }
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
            onSubmit={(e) => {
              e.preventDefault()
              setEditing(false)
              saveNickname(nickname.trim())
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <input
              ref={inputRef}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onBlur={() => {
                setEditing(false)
                saveNickname(nickname.trim())
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
                userSelect: 'none',
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
                <path
                  d="M14.7 3.29a1 1 0 0 1 1.41 0l.6.6a1 1 0 0 1 0 1.41l-9.1 9.1-2.12.7.7-2.12 9.1-9.1z"
                  stroke="#8ef"
                  strokeWidth="1.5"
                  fill="#8ef"
                />
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
      <div
        className="recording-actions"
        style={{
          display: 'flex',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: '12px',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          maxWidth: '600px',
        }}
      >
        {prev && (
          <button
            onClick={() => onNavigate(prev.filename, prev.motionTimestamps)}
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
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1'
              e.currentTarget.style.color = '#1cf1d1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff'
              e.currentTarget.style.color = '#fff'
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
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1'
            e.currentTarget.style.color = '#1cf1d1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff'
            e.currentTarget.style.color = '#fff'
          }}
        >
          Close
        </button>
        {next && (
          <button
            onClick={() => onNavigate(next.filename, next.motionTimestamps)}
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
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #1cf1d1'
              e.currentTarget.style.color = '#1cf1d1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'inset 0 -3px 0 0 #fff'
              e.currentTarget.style.color = '#fff'
            }}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  )
}

function formatTime(sec: number) {
  if (!isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
