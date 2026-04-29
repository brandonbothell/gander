import React, { useState, useEffect } from 'react'
import { type Stream } from '../../../source/types/shared'

interface StreamSettingsModalProps {
  showModal: boolean
  stream: Stream | null
  onClose: () => void
  onSave: (
    stream: Stream,
    newNickname: string,
    newFfmpegInput: string,
    newRtspUser: string,
    newRtspPass: string,
  ) => Promise<void>
  onReconnect: (stream: Stream) => Promise<void> // <-- Add this prop
}

const StreamSettingsModal: React.FC<StreamSettingsModalProps> = ({
  showModal,
  stream,
  onClose,
  onSave,
  onReconnect,
}) => {
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [ffmpegInputDraft, setFfmpegInputDraft] = useState('')
  const [rtspUserDraft, setRtspUserDraft] = useState('')
  const [rtspPassDraft, setRtspPassDraft] = useState('')
  const [reconnecting, setReconnecting] = useState(false)
  const [showReconnectedMessage, setShowReconnectedMessage] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const lastReconnectingRef = React.useRef<boolean>(reconnecting)

  // Update drafts when stream changes
  useEffect(() => {
    if (stream) {
      setNicknameDraft(stream.nickname || '')
      setFfmpegInputDraft(stream.ffmpegInput || '')
      setRtspUserDraft(stream.rtspUser || '')
      setRtspPassDraft(stream.rtspPass || '')
    }
  }, [stream])

  const handleClose = () => {
    onClose()
    setNicknameDraft('')
    setFfmpegInputDraft('')
    setRtspUserDraft('')
    setRtspPassDraft('')
    setSaveError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaveError(null)

    // Basic client validation
    if (!nicknameDraft.trim() || !ffmpegInputDraft.trim()) {
      setSaveError('Nickname and Stream URL are required.')
      return
    }
    if (
      !/^rtsp:\/\//i.test(ffmpegInputDraft.trim()) &&
      !/^video=.+:audio=.+/i.test(ffmpegInputDraft.trim())
    ) {
      setSaveError(
        'Stream URL must be an RTSP URL or a video=...:audio=... string.',
      )
      return
    }

    if (stream) {
      try {
        await onSave(
          stream,
          nicknameDraft.trim(),
          ffmpegInputDraft.trim(),
          rtspUserDraft.trim(),
          rtspPassDraft.trim(),
        )
        handleClose()
      } catch (err) {
        if (err instanceof Error) {
          setSaveError(err.message || 'Failed to save stream.')
        } else {
          setSaveError(String(err) || 'Failed to save stream.')
        }
      }
    }
  }

  const handleReconnect = async () => {
    if (!stream) return
    setReconnecting(true)
    try {
      await onReconnect(stream)
    } finally {
      setReconnecting(false)
    }
  }

  useEffect(() => {
    if (lastReconnectingRef.current !== reconnecting && !reconnecting) {
      setShowReconnectedMessage(true)
      setTimeout(() => setShowReconnectedMessage(false), 3000)
    }
    lastReconnectingRef.current = reconnecting
  }, [reconnecting])

  if (!showModal || !stream) return null

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
      onClick={handleClose}
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
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Stream Settings</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label>Nickname</label>
            <input
              type="text"
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
              style={{
                width: '100%',
                padding: 8,
                borderRadius: 4,
                border: '1px solid #1976d2',
                marginTop: 4,
                marginBottom: 8,
              }}
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label>Stream URL (RTSP or video=...:audio=...)</label>
            <input
              type="text"
              value={ffmpegInputDraft}
              onChange={(e) => setFfmpegInputDraft(e.target.value)}
              style={{
                width: '100%',
                padding: 8,
                borderRadius: 4,
                border: '1px solid #1976d2',
                marginTop: 4,
                marginBottom: 8,
              }}
              required
            />
          </div>
          {/^rtsp:\/\//i.test(ffmpegInputDraft.trim()) && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label>RTSP Username (optional)</label>
                <input
                  type="text"
                  value={rtspUserDraft}
                  onChange={(e) => setRtspUserDraft(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 8,
                    borderRadius: 4,
                    border: '1px solid #1976d2',
                    marginTop: 4,
                    marginBottom: 8,
                  }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label>RTSP Password (optional)</label>
                <input
                  type="password"
                  value={rtspPassDraft}
                  onChange={(e) => setRtspPassDraft(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 8,
                    borderRadius: 4,
                    border: '1px solid #1976d2',
                    marginTop: 4,
                    marginBottom: 8,
                  }}
                />
              </div>
            </>
          )}
          {saveError && (
            <div style={{ color: '#ff6b6b', marginBottom: 12 }}>
              {saveError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button
              type="button"
              onClick={handleClose}
              style={{
                background: '#444',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 18px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
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
              Save
            </button>
            <button
              type="button"
              onClick={handleReconnect}
              disabled={reconnecting || showReconnectedMessage}
              style={{
                background: showReconnectedMessage
                  ? 'rgb(30, 209, 51)'
                  : '#1976d2',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 18px',
                fontWeight: 600,
                cursor: reconnecting ? 'not-allowed' : 'pointer',
                opacity: reconnecting ? 0.7 : 1,
              }}
            >
              {reconnecting
                ? 'Reconnecting...'
                : showReconnectedMessage
                  ? 'Reconnected!'
                  : 'Reconnect Camera'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default StreamSettingsModal
