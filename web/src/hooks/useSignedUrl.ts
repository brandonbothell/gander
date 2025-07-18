import { useEffect, useState } from 'react';
import { API_BASE } from '../main';

type SignedUrlKey = `${string}_${'video' | 'thumbnail'}_${string}`;
type SignedUrlCache = Record<SignedUrlKey, { url: string; expiresAt: number }>;

function getMasterCache(): SignedUrlCache {
  try {
    return JSON.parse(localStorage.getItem('signedUrlCache') || '{}');
  } catch {
    return {};
  }
}

function setMasterCache(cache: SignedUrlCache) {
  localStorage.setItem('signedUrlCache', JSON.stringify(cache));
}

function getCacheKey(filename: string, type: 'video' | 'thumbnail', streamId: string): SignedUrlKey {
  return `${streamId}_${type}_${filename}`;
}

export function useSignedUrl(filename: string, type: 'video' | 'thumbnail', streamId: string) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!filename) return;
    const cacheKey = getCacheKey(filename, type, streamId);
    const cache = getMasterCache();
    const cached = cache[cacheKey];
    const now = Math.floor(Date.now() / 1000);

    // If we have a cached URL and it hasn't expired, use it
    if (cached && cached.expiresAt > now - 10) {
      setUrl(cached.url);
      return;
    }

    fetch(
      `${API_BASE}/api/signed-url/${streamId}?filename=${encodeURIComponent(filename)}&type=${type}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt') || ''}`,
        },
      }
    )
      .then(res => res.json())
      .then(data => {
        const fullUrl = `${API_BASE}${data.url}`;
        setUrl(fullUrl);
        if (data.expiresAt) {
          const newCache = { ...getMasterCache(), [cacheKey]: { url: fullUrl, expiresAt: data.expiresAt } };
          setMasterCache(newCache);
        }
      })
      .catch(() => setUrl(''));
  }, [filename, type, streamId]);

  return url;
}
