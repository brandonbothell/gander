import { useEffect, useState, useRef } from 'react';
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
  // Primary storage by cache key
  urls: Record<SignedUrlKey, SignedUrlEntry>;

  // Expiration index - sorted array of [expiresAt, cacheKey] tuples
  expirationIndex: Array<[number, SignedUrlKey]>;

  // Stream index for quick lookup by stream
  streamIndex: Record<string, SignedUrlKey[]>;

  // Metadata
  lastCleanup: number;
  totalUrls: number;
}

// Global interval for background cleanup/refresh
let cleanupInterval: number | null = null;
let visibilityChangeHandler: (() => void) | null = null;
let activeHooks = new Set<() => void>();

function getMasterCache(): SignedUrlCache {
  try {
    const cached = JSON.parse(localStorage.getItem('signedUrlCache') || 'null');
    if (cached && cached.urls) {
      return cached;
    }
  } catch {
    // Fall back to empty cache
  }

  return {
    urls: {},
    expirationIndex: [],
    streamIndex: {},
    lastCleanup: Date.now(),
    totalUrls: 0
  };
}

function setMasterCache(cache: SignedUrlCache) {
  // Keep expiration index sorted and clean
  cache.expirationIndex.sort((a, b) => a[0] - b[0]);
  cache.totalUrls = Object.keys(cache.urls).length;

  try {
    localStorage.setItem('signedUrlCache', JSON.stringify(cache));
  } catch (error) {
    // If localStorage is full, clean up aggressively
    console.warn('localStorage full, cleaning cache:', error);
    aggressiveCleanup(cache);
    localStorage.setItem('signedUrlCache', JSON.stringify(cache));
  }
}

function getCacheKey(filename: string, type: 'video' | 'thumbnail', streamId: string): SignedUrlKey {
  return `${streamId}_${type}_${filename}`;
}

// Add entry to cache with proper indexing
function addToCache(cache: SignedUrlCache, key: SignedUrlKey, entry: SignedUrlEntry): SignedUrlCache {
  const newCache = { ...cache };

  // Remove old entry if it exists
  if (newCache.urls[key]) {
    removeFromCache(newCache, key);
  }

  // Add to main storage
  newCache.urls[key] = entry;

  // Add to expiration index
  newCache.expirationIndex.push([entry.expiresAt, key]);

  // Add to stream index
  if (!newCache.streamIndex[entry.streamId]) {
    newCache.streamIndex[entry.streamId] = [];
  }
  newCache.streamIndex[entry.streamId].push(key);

  return newCache;
}

// Remove entry from cache and all indices
function removeFromCache(cache: SignedUrlCache, key: SignedUrlKey): void {
  const entry = cache.urls[key];
  if (!entry) return;

  // Remove from main storage
  delete cache.urls[key];

  // Remove from expiration index
  cache.expirationIndex = cache.expirationIndex.filter(([, k]) => k !== key);

  // Remove from stream index
  if (cache.streamIndex[entry.streamId]) {
    cache.streamIndex[entry.streamId] = cache.streamIndex[entry.streamId].filter(k => k !== key);
    if (cache.streamIndex[entry.streamId].length === 0) {
      delete cache.streamIndex[entry.streamId];
    }
  }
}

// Efficient cleanup using expiration index
function cleanupExpiredUrls(cache: SignedUrlCache, now: number): { expiredCount: number; cache: SignedUrlCache } {
  const newCache = { ...cache };
  let expiredCount = 0;

  // Find all expired entries using the sorted expiration index
  const expiredEntries: SignedUrlKey[] = [];

  for (const [expiresAt, key] of newCache.expirationIndex) {
    if (expiresAt <= now) {
      expiredEntries.push(key);
      expiredCount++;
    } else {
      // Since array is sorted, we can break early
      break;
    }
  }

  // Remove all expired entries
  expiredEntries.forEach(key => removeFromCache(newCache, key));

  return { expiredCount, cache: newCache };
}

// Find URLs expiring soon using expiration index
function findSoonToExpireUrls(cache: SignedUrlCache, now: number, withinSeconds: number): SignedUrlKey[] {
  const threshold = now + withinSeconds;
  const soonToExpire: SignedUrlKey[] = [];

  for (const [expiresAt, key] of cache.expirationIndex) {
    if (expiresAt > now && expiresAt <= threshold) {
      soonToExpire.push(key);
    } else if (expiresAt > threshold) {
      // Since array is sorted, we can break early
      break;
    }
  }

  return soonToExpire;
}

// Aggressive cleanup when storage is full
function aggressiveCleanup(cache: SignedUrlCache): void {
  const now = Math.floor(Date.now() / 1000);

  // 1. Remove expired URLs
  const { cache: cleanedCache } = cleanupExpiredUrls(cache, now);
  Object.assign(cache, cleanedCache);

  // 2. If still too many, remove least recently accessed
  const maxUrls = 1000; // Reasonable limit
  if (cache.totalUrls > maxUrls) {
    const entries = Object.entries(cache.urls)
      .map(([key, entry]) => ({ key: key as SignedUrlKey, entry }))
      .sort((a, b) => a.entry.lastAccessed - b.entry.lastAccessed);

    const toRemove = entries.slice(0, cache.totalUrls - maxUrls);
    toRemove.forEach(({ key }) => removeFromCache(cache, key));
  }
}

// Background cleanup and refresh function
async function cleanupAndRefreshCache() {
  const cache = getMasterCache();
  const now = Math.floor(Date.now() / 1000);

  // 1. Clean up expired URLs efficiently
  const { expiredCount, cache: cleanedCache } = cleanupExpiredUrls(cache, now);

  if (expiredCount > 0) {
    console.log(`Cleaned up ${expiredCount} expired signed URLs`);
  }

  // 2. Find URLs expiring within 1 minute
  const soonToExpireKeys = findSoonToExpireUrls(cleanedCache, now, 60);

  if (soonToExpireKeys.length > 0) {
    console.log(`Refreshing ${soonToExpireKeys.length} soon-to-expire signed URLs`);

    // Refresh in batches to avoid overwhelming the server
    const batchSize = 10;
    for (let i = 0; i < soonToExpireKeys.length; i += batchSize) {
      const batch = soonToExpireKeys.slice(i, i + batchSize);

      const refreshPromises = batch.map(async (key) => {
        try {
          const entry = cleanedCache.urls[key];
          if (!entry) return;

          const response = await authFetch(
            `${API_BASE}/api/signed-url/${entry.streamId}?filename=${encodeURIComponent(entry.filename)}&type=${entry.type}`
          );

          if (response.ok) {
            const data = await response.json();
            const fullUrl = `${API_BASE}${data.url}`;

            // Update cache with new URL
            const currentCache = getMasterCache();
            const updatedEntry: SignedUrlEntry = {
              ...entry,
              url: fullUrl,
              expiresAt: data.expiresAt,
              lastAccessed: now
            };

            const newCache = addToCache(currentCache, key, updatedEntry);
            setMasterCache(newCache);

            // console.log(`Refreshed signed URL for ${key}`);
          }
        } catch (error) {
          console.warn(`Failed to refresh signed URL for ${key}:`, error);
        }
      });

      await Promise.allSettled(refreshPromises);

      // Small delay between batches
      if (i + batchSize < soonToExpireKeys.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Notify all active hooks to update their URLs
    activeHooks.forEach(refresh => refresh());
  }

  // 3. Update last cleanup time
  cleanedCache.lastCleanup = Date.now();
  setMasterCache(cleanedCache);
}

// Start background cleanup if not already running
function startBackgroundCleanup() {
  if (cleanupInterval) return;

  // Run cleanup every 2 minutes
  cleanupInterval = setInterval(cleanupAndRefreshCache, 2 * 60 * 1000);

  // Also run cleanup on visibility change (when user returns to tab)
  visibilityChangeHandler = () => {
    if (!document.hidden) {
      cleanupAndRefreshCache();
    }
  };

  document.addEventListener('visibilitychange', visibilityChangeHandler);
}

// Stop background cleanup when no hooks are active
function stopBackgroundCleanup() {
  if (cleanupInterval && activeHooks.size === 0) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;

    if (visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', visibilityChangeHandler);
      visibilityChangeHandler = null;
    }
  }
}

export function useSignedUrl(filename: string, type: 'video' | 'thumbnail', streamId: string) {
  const [url, setUrl] = useState('');
  const refreshRef = useRef<() => void>(() => { });

  // Function to fetch/refresh the signed URL
  const fetchSignedUrl = async (useCache = true) => {
    if (!filename) {
      setUrl('');
      return;
    }

    const cacheKey = getCacheKey(filename, type, streamId);
    const cache = getMasterCache();
    const cached = cache.urls[cacheKey];
    const now = Math.floor(Date.now() / 1000);

    // If we have a cached URL and it hasn't expired (with 10 second buffer), use it
    if (useCache && cached && cached.expiresAt > now + 10) {
      setUrl(cached.url);

      // Update last accessed time
      cached.lastAccessed = now;
      const newCache = addToCache(cache, cacheKey, cached);
      setMasterCache(newCache);
      return;
    }

    try {
      const response = await authFetch(
        `${API_BASE}/api/signed-url/${streamId}?filename=${encodeURIComponent(filename)}&type=${type}`
      );

      if (response.ok) {
        const data = await response.json();
        const fullUrl = `${API_BASE}${data.url}`;
        setUrl(fullUrl);

        if (data.expiresAt) {
          const entry: SignedUrlEntry = {
            url: fullUrl,
            expiresAt: data.expiresAt,
            streamId,
            filename,
            type,
            lastAccessed: now
          };

          const newCache = addToCache(getMasterCache(), cacheKey, entry);
          setMasterCache(newCache);
        }
      } else {
        console.warn(`Failed to fetch signed URL for ${filename}:`, response.status);
        setUrl('');
      }
    } catch (error) {
      console.warn(`Error fetching signed URL for ${filename}:`, error);
      setUrl('');
    }
  };

  // Create refresh function that forces a new fetch
  refreshRef.current = () => {
    fetchSignedUrl(false); // Don't use cache when refreshing
  };

  useEffect(() => {
    // Add this hook to active hooks for background refresh notifications
    const refreshFn = refreshRef.current!;
    activeHooks.add(refreshFn);

    // Start background cleanup if this is the first active hook
    if (activeHooks.size === 1) {
      startBackgroundCleanup();
    }

    // Initial fetch
    fetchSignedUrl();

    return () => {
      // Remove this hook from active hooks
      activeHooks.delete(refreshFn);

      // Stop background cleanup if no hooks are active
      if (activeHooks.size === 0) {
        stopBackgroundCleanup();
      }
    };
  }, [filename, type, streamId]);

  return url;
}

// Export function to manually trigger cache cleanup (useful for testing)
export function cleanupSignedUrlCache() {
  return cleanupAndRefreshCache();
}

// Export function to clear all cached URLs (useful for logout)
export function clearSignedUrlCache() {
  localStorage.removeItem('signedUrlCache');
  activeHooks.forEach(refresh => refresh());
}

// Export function to get cache statistics
export function getSignedUrlCacheStats() {
  const cache = getMasterCache();
  const now = Math.floor(Date.now() / 1000);

  const expiredCount = cache.expirationIndex.filter(([expiresAt]) => expiresAt <= now).length;
  const soonToExpireCount = findSoonToExpireUrls(cache, now, 300).length;

  return {
    totalUrls: cache.totalUrls,
    expiredUrls: expiredCount,
    soonToExpireUrls: soonToExpireCount,
    streamCount: Object.keys(cache.streamIndex).length,
    lastCleanup: new Date(cache.lastCleanup).toISOString()
  };
}

// Export function to clear cache for specific stream (useful when stream is deleted)
export function clearStreamCache(streamId: string) {
  const cache = getMasterCache();
  const streamKeys = cache.streamIndex[streamId] || [];

  streamKeys.forEach(key => removeFromCache(cache, key));
  setMasterCache(cache);

  console.log(`Cleared ${streamKeys.length} cached URLs for stream ${streamId}`);
}
