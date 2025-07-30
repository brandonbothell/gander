import React, { useState, useEffect } from 'react';
import { type Stream } from '../../../source/types/shared';

interface StreamSettingsModalProps {
  showModal: boolean;
  stream: Stream | null;
  onClose: () => void;
  onSave: (stream: Stream, newNickname: string) => Promise<void>;
  onReconnect: (stream: Stream) => Promise<void>; // <-- Add this prop
}

const StreamSettingsModal: React.FC<StreamSettingsModalProps> = ({
  showModal,
  stream,
  onClose,
  onSave,
  onReconnect,
}) => {
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [showReconnectedMessage, setShowReconnectedMessage] = useState(false);
  const lastReconnectingRef = React.useRef<boolean>(reconnecting);

  // Update draft when stream changes
  useEffect(() => {
    if (stream) {
      setNicknameDraft(stream.nickname || '');
    }
  }, [stream]);

  const handleClose = () => {
    onClose();
    setNicknameDraft('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stream) {
      await onSave(stream, nicknameDraft);
      handleClose();
    }
  };

  const handleReconnect = async () => {
    if (!stream) return;
    setReconnecting(true);
    try {
      await onReconnect(stream);
    } finally {
      setReconnecting(false);
    }
  };

  useEffect(() => {
    if (lastReconnectingRef.current !== reconnecting && !reconnecting) {
      setShowReconnectedMessage(true);
      setTimeout(() => setShowReconnectedMessage(false), 3000); // Show message for 3 seconds
    }
    lastReconnectingRef.current = reconnecting;
  }, [reconnecting]);

  if (!showModal || !stream) return null;

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
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Stream Settings</h2>
        <form onSubmit={handleSubmit}>
          <label style={{ fontWeight: 500, marginBottom: 6, display: 'block' }}>
            Edit Nickname
          </label>
          <input
            type="text"
            value={nicknameDraft}
            onChange={e => setNicknameDraft(e.target.value)}
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 4,
              border: '1px solid #1976d2',
              marginTop: 4,
              marginBottom: 16,
            }}
            autoFocus
          />
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
                background: showReconnectedMessage ? 'rgb(30, 209, 51)' : '#1976d2',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 18px',
                fontWeight: 600,
                cursor: reconnecting ? 'not-allowed' : 'pointer',
                opacity: reconnecting ? 0.7 : 1,
              }}
            >
              {reconnecting ? 'Reconnecting...' : showReconnectedMessage ? 'Reconnected!' : 'Reconnect Camera'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StreamSettingsModal;
