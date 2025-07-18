import { useEffect, useRef, useState } from 'react';
import { Recording } from './Recording';
import { isIOS } from '../StreamPage';

interface RecordingBarProps {
  open: boolean;
  streamId: string;
  filename: string;
  onClose: () => void;
  cachedRecordings: { streamId: string; filename: string }[];
  onNavigate: (filename: string) => void;
  setAutoScrollUntilRef: (until: number) => void;
  setNicknames: React.Dispatch<React.SetStateAction<{
    [filename: string]: string;
  }>>;
}

const ANIMATION_DURATION = 700; // ms, match your CSS

export function RecordingBar(props: RecordingBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(props.open);

  useEffect(() => {
    if (props.open) {
      setVisible(true); // Immediately set visible when opening
    } else {
      const timeout = setTimeout(() => setVisible(false), ANIMATION_DURATION);
      return () => clearTimeout(timeout);
    }
  }, [props.open]);

  if (!visible && !props.open) return null;

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
            transition: 'transform 0.7s cubic-bezier(.4,2,.6,1), opacity 0.7s cubic-bezier(.4,2,.6,1)',
            overflow: 'hidden',
            pointerEvents: props.open ? 'auto' : 'none',
          }}
        >
          <button
            aria-label="Close"
            onClick={props.onClose}
            style={{
              position: 'absolute',
              top: 12,
              right: isIOS() ? 36 : 12,
              zIndex: 10,
              background: 'rgba(30,30,60,0.85)',
              color: '#fff',
              border: 'none',
              borderRadius: 24,
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              cursor: 'pointer',
              boxShadow: '0 2px 8px #1a2980aa',
              transition: 'background 0.2s',
              fontWeight: 'bold',
            }}
          >
            ×
          </button>
          <Recording {...props} />
        </div>
      </div>
    </div>
  );
}
