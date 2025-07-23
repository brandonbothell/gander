const DEBUG_LOGS_KEY = 'debug_logs';
const MAX_DEBUG_LOGS = 100;

export const debugLog = (message: string, level: 'info' | 'error' | 'warn' = 'info') => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  // Always console.log (works in web dev)
  if (level === 'error') {
    console.error(logEntry);
  } else if (level === 'warn') {
    console.warn(logEntry);
  } else {
    console.log(logEntry);
  }

  // Store in localStorage for native debugging
  try {
    const existingLogs = JSON.parse(localStorage.getItem(DEBUG_LOGS_KEY) || '[]');
    existingLogs.push(logEntry);

    // Keep only the last MAX_DEBUG_LOGS entries
    if (existingLogs.length > MAX_DEBUG_LOGS) {
      existingLogs.splice(0, existingLogs.length - MAX_DEBUG_LOGS);
    }

    localStorage.setItem(DEBUG_LOGS_KEY, JSON.stringify(existingLogs));
  } catch (e) {
    // Ignore localStorage errors
  }
};

// Add this function to view debug logs (you can call this in browser dev tools)
export const getDebugLogs = () => {
  try {
    const logs = JSON.parse(localStorage.getItem(DEBUG_LOGS_KEY) || '[]');
    return logs.join('\n');
  } catch (e) {
    return 'No debug logs available';
  }
};

// Make it globally available for debugging
(window as any).getDebugLogs = getDebugLogs;
(window as any).clearDebugLogs = () => localStorage.removeItem(DEBUG_LOGS_KEY);
