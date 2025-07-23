import { useEffect, useState } from "react";
import { getDebugLogs } from "../utils/debugLog";

// Add this debug component somewhere in your app (maybe accessible via a hidden button)
export const DebugInfo = ({ onClose }: { onClose: () => void }) => {
  const [logs, setLogs] = useState('');

  useEffect(() => {
    setLogs(getDebugLogs());
  }, []);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.9)',
      color: 'white',
      zIndex: 9999,
      padding: 20,
      overflow: 'auto'
    }}>
      <div style={{ marginBottom: 20 }}>
        <button onClick={onClose} style={{ marginRight: 10 }}>Close</button>
        <button onClick={() => {
          (window as any).clearDebugLogs();
          setLogs('');
        }}>Clear Logs</button>
      </div>
      <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {logs || 'No debug logs available'}
      </pre>
    </div>
  );
};
