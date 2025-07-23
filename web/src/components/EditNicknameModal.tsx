import React, { useState, useEffect } from 'react';
import { type Stream } from '../../../source/types/shared';

interface EditNicknameModalProps {
  showModal: boolean;
  stream: Stream | null;
  onClose: () => void;
  onSave: (stream: Stream, newNickname: string) => Promise<void>;
}

const EditNicknameModal: React.FC<EditNicknameModalProps> = ({
  showModal,
  stream,
  onClose,
  onSave,
}) => {
  const [nicknameDraft, setNicknameDraft] = useState('');

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
        <h2 style={{ marginTop: 0 }}>Edit Nickname</h2>
        <form onSubmit={handleSubmit}>
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
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditNicknameModal;
