import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useLoading } from '../LoadingContext';

export function RouterLoadingHandler() {
  const location = useLocation();
  const { setLoading } = useLoading();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    // Simulate loading for at least 600ms, or until your page data is ready
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setLoading(false), 600); // adjust as needed
    // Optionally, you can clear loading in your page's data fetch .finally()
    // for more precise control.
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line
  }, [location.key]); // triggers on every navigation

  return null;
}
