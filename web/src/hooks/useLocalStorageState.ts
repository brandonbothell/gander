import { useState, useCallback, useEffect } from 'react';

export function useLocalStorageState<T>(key: string, defaultValue: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState(prev => {
        const newValue = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
        localStorage.setItem(key, JSON.stringify(newValue));
        return newValue;
      });
    },
    [key]
  );

  // Listen for changes to localStorage from other tabs/windows or manual updates
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === key) {
        try {
          setState(e.newValue !== null ? JSON.parse(e.newValue) : defaultValue);
        } catch {
          setState(defaultValue);
        }
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [key, defaultValue]);

  return [state, setValue] as const;
}
