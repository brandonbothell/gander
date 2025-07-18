export function RecordingIndicator({ recording, secondsLeft }: { recording: boolean, secondsLeft: number }) {
  if (!recording) return null;
  return (
    <div className="recording-indicator">
      <span className="recording-dot" />
      <span>Recording</span>
      <span className="recording-seconds">{secondsLeft}s</span>
    </div>
  );
}
