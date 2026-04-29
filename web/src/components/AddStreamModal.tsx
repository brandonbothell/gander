import React, { useState } from 'react'
import { type Stream } from '../../../source/types/shared'

interface AddStreamModalProps {
  showModal: boolean
  onClose: () => void
  onStreamCreated: (stream: Stream) => void
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  API_BASE: string
}

const AddStreamModal: React.FC<AddStreamModalProps> = ({
  showModal,
  onClose,
  onStreamCreated,
  authFetch,
  API_BASE,
}) => {
  const [newStream, setNewStream] = useState({
    nickname: '',
    ffmpegInput: '',
    rtspUser: '',
    rtspPass: '',
  })
  const [creatingStream, setCreatingStream] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const handleClose = () => {
    onClose()
    setNewStream({ nickname: '', ffmpegInput: '', rtspUser: '', rtspPass: '' })
    setCreateError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreatingStream(true)
    setCreateError(null)

    // Basic client validation
    if (!newStream.nickname.trim() || !newStream.ffmpegInput.trim()) {
      setCreateError('Nickname and Stream URL are required.')
      setCreatingStream(false)
      return
    }

    // Only allow RTSP or video=...:audio=... for ffmpegInput
    if (
      !/^rtsp:\/\//i.test(newStream.ffmpegInput.trim()) &&
      !/^video=.+:audio=.+/i.test(newStream.ffmpegInput.trim())
    ) {
      setCreateError(
        'Stream URL must be an RTSP URL or a video=...:audio=... string.',
      )
      setCreatingStream(false)
      return
    }

    try {
      const res = await authFetch(`${API_BASE}/api/streams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: newStream.nickname.trim(),
          ffmpegInput: newStream.ffmpegInput.trim(),
          rtspUser: newStream.rtspUser.trim() || undefined,
          rtspPass: newStream.rtspPass.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setCreateError(data.error || 'Failed to create stream.')
        setCreatingStream(false)
        return
      }

      const data = await res.json()
      onStreamCreated(data)
      handleClose()
    } catch (err) {
      setCreateError(
        (err as { message?: string })?.message || 'Failed to create stream.',
      )
    }
    setCreatingStream(false)
  }

  if (!showModal) return null

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
        <h2 style={{ marginTop: 0 }}>Add New Stream</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label>Nickname</label>
            <input
              type="text"
              value={newStream.nickname}
              onChange={(e) =>
                setNewStream((s) => ({ ...s, nickname: e.target.value }))
              }
              style={{
                width: '100%',
                padding: 8,
                borderRadius: 4,
                border: '1px solid #1976d2',
                marginTop: 4,
                marginBottom: 8,
              }}
              required
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label>Stream URL (RTSP or video=...:audio=...)</label>
            <input
              type="text"
              value={newStream.ffmpegInput}
              onChange={(e) =>
                setNewStream((s) => ({ ...s, ffmpegInput: e.target.value }))
              }
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
          {/^rtsp:\/\//i.test(newStream.ffmpegInput.trim()) && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label>RTSP Username (optional)</label>
                <input
                  type="text"
                  value={newStream.rtspUser}
                  onChange={(e) =>
                    setNewStream((s) => ({ ...s, rtspUser: e.target.value }))
                  }
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
                  value={newStream.rtspPass}
                  onChange={(e) =>
                    setNewStream((s) => ({ ...s, rtspPass: e.target.value }))
                  }
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
          {createError && (
            <div style={{ color: '#ff6b6b', marginBottom: 12 }}>
              {createError}
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
              disabled={creatingStream}
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
                cursor: creatingStream ? 'not-allowed' : 'pointer',
                opacity: creatingStream ? 0.7 : 1,
              }}
              disabled={creatingStream}
            >
              {creatingStream ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddStreamModal
