import { useEffect, useRef, useState } from 'react'
import { Recording, type RecordingType } from './Recording'

interface RecordingBarProps {
  open: boolean
  streamId: string
  filename: string
  motionTimestamps: number[]
  onClose: () => void
  cachedRecordings: RecordingType[]
  isMobile: boolean
  onNavigate: (filename: string, motionTimestamps: number[]) => void
  setAutoScrollUntilRef: (until: number) => void
  setNicknames: React.Dispatch<
    React.SetStateAction<{
      [filename: string]: string
    }>
  >
  setOpeningRecording: (opening: boolean) => void
}

const ANIMATION_DURATION = 700 // ms, match your CSS

export function RecordingBar(props: RecordingBarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [viewing, setViewing] = useState(props.open)

  // Sync video state
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handlePlay = () => setViewing(true)
    const handlePause = () => setViewing(false)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [videoRef, props.filename])

  useEffect(() => {
    if (props.open) {
      setViewing(true)
    } else {
      const timeout = setTimeout(() => setViewing(false), ANIMATION_DURATION)
      return () => clearTimeout(timeout)
    }
  }, [props.open])

  if (!viewing && !props.open) return null

  return (
    <div
      className={`recording-bar-collapse${props.open ? '' : ' closed'}`}
      style={{ width: '100%' }}
    >
      <div
        ref={barRef}
        className={`recording-bar${props.open ? ' open' : ''}`}
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          marginBottom: 64,
          pointerEvents: 'auto',
          transition: 'none',
        }}
        aria-hidden={!props.open}
      >
        <div
          className="recording-bar-content"
          style={{
            marginTop: 0,
            borderRadius: '0 0 18px 18px',
            boxShadow: '0 8px 32px #1a2980cc',
            background: '#232b4a',
            position: 'relative',
            minWidth: 320,
            maxWidth: '98vw',
            width: 'min(900px, 98vw)',
            opacity: props.open ? 1 : 0,
            transition:
              'transform 0.7s cubic-bezier(.4,2,.6,1), opacity 0.7s cubic-bezier(.4,2,.6,1)',
            overflow: 'hidden',
            pointerEvents: props.open ? 'auto' : 'none',
          }}
        >
          {/* Pass videoRef to Recording */}
          <Recording {...props} videoRef={videoRef} />
        </div>
      </div>
    </div>
  )
}
