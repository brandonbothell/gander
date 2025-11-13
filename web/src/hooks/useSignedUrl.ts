import { useEffect, useState } from 'react';
import { API_BASE, authFetch } from '../main';

type SignedUrlKey = `${string}_${'video' | 'thumbnail'}_${string}`;

interface SignedUrlEntry {
  url: string;
  expiresAt: number;
  streamId: string;
  filename: string;
  type: 'video' | 'thumbnail';
  lastAccessed: number;
}

interface SignedUrlCache {
  urls: Record<SignedUrlKey, SignedUrlEntry>;
}

// --- Singleton in-memory cache ---
let memoryCache: SignedUrlCache | null = null;

function loadCache(): SignedUrlCache {
  if (memoryCache) return memoryCache;
  try {
    const cached = JSON.parse(localStorage.getItem('signedUrlCache') || 'null');
    if (cached && cached.urls) {
      memoryCache = cached;
      return memoryCache || { urls: {} };
    }
  } catch {
    // Ignore parse errors
  }
  memoryCache = { urls: {} };
  return memoryCache;
}

function saveCache() {
  if (memoryCache) {
    try {
      localStorage.setItem('signedUrlCache', JSON.stringify(memoryCache));
    } catch (error) {
      console.warn('localStorage full, clearing cache:', error);
      localStorage.removeItem('signedUrlCache');
    }
  }
}

function getCacheKey(filename: string, type: 'video' | 'thumbnail', streamId: string): SignedUrlKey {
  return `${streamId}_${type}_${filename}`;
}

export function useSignedUrl(filename: string, type: 'video' | 'thumbnail', streamId: string) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let isMounted = true;
    const fetchSignedUrl = async () => {
      if (!filename) {
        setUrl('');
        return;
      }

      const cache = loadCache();
      const cacheKey = getCacheKey(filename, type, streamId);
      const cached = cache.urls[cacheKey];
      const now = Math.floor(Date.now() / 1000);

      if (cached && cached.expiresAt > now + 10) {
        setUrl(cached.url);
        cached.lastAccessed = now; // update in memory only
        return;
      }

      try {
        const response = await authFetch(
          `${API_BASE}/api/signed-url/${streamId}?filename=${encodeURIComponent(filename)}&type=${type}`
        );

        if (response.ok) {
          const data = await response.json();
          const fullUrl = `${API_BASE}${data.url}`;
          if (isMounted) setUrl(fullUrl);

          if (data.expiresAt) {
            const entry: SignedUrlEntry = {
              url: fullUrl,
              expiresAt: data.expiresAt,
              streamId,
              filename,
              type,
              lastAccessed: now
            };
            cache.urls[cacheKey] = entry;
            saveCache(); // Only update localStorage when a new URL is fetched
          }
        } else {
          console.warn(`Failed to fetch signed URL for ${filename}:`, response.status);
          if (isMounted) setUrl('');
        }
      } catch (error) {
        console.warn(`Error fetching signed URL for ${filename}:`, error);
        if (isMounted) setUrl('');
      }
    };

    fetchSignedUrl();
    return () => { isMounted = false; };
  }, [filename, type, streamId]);

  return url;
}

// Export function to clear all cached URLs (useful for logout)
export function clearSignedUrlCache() {
  memoryCache = { urls: {} };
  localStorage.removeItem('signedUrlCache');
}

// Export function to get cache statistics
export function getSignedUrlCacheStats() {
  const cache = loadCache();
  const now = Math.floor(Date.now() / 1000);

  const expiredUrls = Object.values(cache.urls).filter(entry => entry.expiresAt <= now).length;
  const totalUrls = Object.keys(cache.urls).length;

  return {
    totalUrls,
    expiredUrls
  };
}

// Export function to clear cache for specific stream (useful when stream is deleted)
export function clearStreamCache(streamId: string) {
  const cache = loadCache();
  const keysToRemove = Object.keys(cache.urls).filter(key => key.startsWith(`${streamId}_`)) as Array<`${string}_video_${string}` | `${string}_thumbnail_${string}`>;
  keysToRemove.forEach(key => delete cache.urls[key]);
  saveCache();

  console.log(`Cleared ${keysToRemove.length} cached URLs for stream ${streamId}`);
}
