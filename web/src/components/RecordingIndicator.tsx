interface RecordingIndicatorProps {
  recording?: boolean;
  secondsLeft?: number;
  saving?: boolean; // New prop
}

export function RecordingIndicator({ recording, secondsLeft, saving }: RecordingIndicatorProps) {
  if (saving) {
    return (
      <div className="recording-indicator saving">
        <div className="recording-content">
          <div className="spinner" style={{
            width: 20, height: 20,
            border: '3px solid rgba(255, 193, 7, 0.3)',
            borderTop: '3px solid #ffc107',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginRight: 8
          }} />
          <span>Saving motion recording...</span>
        </div>
      </div>
    );
  }

  if (!recording) return null;

  return (
    <div className="recording-indicator">
      <div className="recording-content">
        <div className="recording-dot" />
        <span style={{ paddingLeft: 8 }}>
          Motion Recording {secondsLeft ? `(${secondsLeft}s)` : ''}
        </span>
      </div>
    </div>
  );
}
