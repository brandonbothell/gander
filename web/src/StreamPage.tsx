import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { API_BASE, authFetch } from './main';
import { setupPushNotifications, subscribeToWebPush } from './pushNotifications';
import { FloatingMenuButton } from './components/FloatingMenuButton';
import { FloatingMenuPopout } from './components/FloatingMenuPopout';
import { MotionService } from './plugins/motionService';
import { useLocalStorageState } from './hooks/useLocalStorageState';
import Hls from 'hls.js';
import { useLoading } from './LoadingProvider';
import { SearchTools } from './components/SearchTools';
import { MaskEditorOverlay } from './components/MaskEditorOverlay';
import { type StreamMask, type Stream } from '../../source/types/shared';
import { FiChevronDown } from 'react-icons/fi';
import { StreamTilesGrid } from './components/StreamTilesGrid';
import AddStreamModal from './components/AddStreamModal';
import StreamSettingsModal from './components/StreamSettingsModal';
import { RecordingBar } from './components/RecordingBar';
import { StreamControlBar } from './components/StreamControlBar';
import type { Recording } from './App';
import SecureStorage from './utils/secureStorage';
import { Preferences } from '@capacitor/preferences';
import { DebugInfo } from './components/DebugInfo';
import RecordingsListContent from './components/RecordingsListContent';
import StreamControls from './components/StreamControls';
import { fetchWithRetry } from './main';
import ErrorModal from './components/ErrorModal';

export type ClientMask = StreamMask & { pendingUpdate?: boolean, pendingUpdateSince?: number };

interface StreamPageProps {
  streamId?: string;
  onShowSessionMonitor?: () => void;
  onSessionMonitorClosed?: () => void; // Add this new prop
  logout: () => Promise<void>;
}

/**
 * StreamPage component
 *
 * The main page for managing and viewing live streams and motion recordings in the SecurityCam web application.
 * 
 * Features:
 * - Displays a grid of available streams with live video, thumbnails, and status indicators.
 * - Allows switching between streams, adding new streams, editing stream nicknames, and deleting streams.
 * - Shows the currently active stream with live HLS playback, mask editing overlay, and motion status.
 * - Provides a searchable, filterable, and paginated list of motion-triggered recordings for the selected stream.
 * - Supports batch selection and deletion of recordings, as well as marking recordings as viewed.
 * - Integrates with push notification settings for motion events.
 * - Handles mobile and desktop layouts, including sticky search/filter bars and touch-friendly controls.
 * - Manages stream order, caching, and efficient polling for new recordings, thumbnails, and motion status.
 * - Includes advanced features such as mask editing, session monitoring, and pull-to-refresh on mobile.
 *
 * Props:
 * @param streamId - (optional) The ID of the stream to select initially.
 * @param onShowSessionMonitor - (optional) Callback to open the session monitor dialog.
 * @param onSessionMonitorClosed - (optional) Callback when the session monitor is closed.
 * @param logout - Function to log out the current user.
 *
 * @returns The main StreamPage React component.
 */
export default function StreamPage({ streamId, onShowSessionMonitor, onSessionMonitorClosed, logout }: StreamPageProps) {
  // --- New state for dynamic streams ---
  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamOrder, setStreamOrder] = useLocalStorageState<string[]>('streamOrder', []);
  const [_streamsLoading, setStreamsLoading] = useState(true);
  const [_streamError, setStreamError] = useState<string | null>(null);
  const [activeStream, setActiveStream] = useState<Stream | null>(null);

  const [showAddStreamModal, setShowAddStreamModal] = useState(false);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editingStream, setEditingStream] = useState<Stream | null>(null);

  const params = useParams<{ streamId?: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const recordingsListRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [cachedRecordings, setCachedRecordings] = useLocalStorageState<{ [streamId: string]: Recording[] }>('cachedRecordings', {});
  const [viewed, setViewed] = useLocalStorageState<{ filename: string; streamId: string }[]>('viewedRecordings', []);
  const [motionStatus, setMotionStatus] = useState<{ [streamId: string]: { recording: boolean; secondsLeft: number; saving: boolean; startedRecordingAt: number } }>({});
  const [isMotionRecordingPaused, setMotionRecordingPaused] = useState<{ [streamId: string]: boolean }>({});
  const [nicknames, setNicknames] = useState<{ [filename: string]: string }>({});
  const [shouldNotifyOnMotion, setShouldNotifyOnMotion] = useLocalStorageState<boolean>('motionNotify', false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useLocalStorageState<string[]>('selectedRecordings', [])
  const [hovered, setHovered] = useState<string | null>(null);
  const [isLoadingMotionNotifications, setIsLoadingMotionNotifications] = useState(true);
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [isNicknamedOnly, setIsNicknamedOnly] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [signedThumbUrls, setSignedThumbUrls] = useLocalStorageState<{ [id: string]: { url: string, expires: number } }>('signedLiveThumbUrls', {});
  const [isVideoPaused, setIsVideoPaused] = useState(false);
  const [deletedRecordings, setDeletedRecordings] = useState<{ [streamId: string]: string[] }>({});
  const [showMaskEditor, setShowMaskEditor] = useState(false);
  const [masks, setMasks] = useState<ClientMask[]>([]);
  const [videoSize, setVideoSize] = useState({ width: 640, height: 360 });
  const [isDraggingMask, setIsDraggingMask] = useState(false);
  const pauseMaskPollingUntil = useRef<number>(0);
  const [searchSticky, setSearchSticky] = useState(false);
  const searchStickyRef = useRef<HTMLDivElement>(null);
  const searchStickySentinelRef = useRef<HTMLDivElement>(null);
  const mobileSearchStickySentinelRef = useRef<HTMLDivElement>(null);
  const [mobileSearchSticky, setMobileSearchSticky] = useState(false);
  const lastStickyRef = useRef(false);
  const lastMobileStickyRef = useRef(false);
  const PAGE_SIZE = 50;
  const [currentPage, setCurrentPage] = useState(1);
  const [lastSeenRecording, setLastSeenRecording] = useLocalStorageState<{ [streamId: string]: string | null }>('lastSeenRecording', {});
  const [reachedLastSeen, setReachedLastSeen] = useState(false);
  const [totalRecordings, setTotalRecordings] = useState<{ [streamId: string]: number }>({});
  const gridOuterRef = useRef<HTMLDivElement>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMobileWidth, setIsMobileWidth] = useState(window.innerWidth < 600);
  const searchToolsRef = useRef<HTMLDivElement>(null);
  const recordingsListBottomSentinelRef = useRef<HTMLDivElement>(null);
  const [isDesktopRefreshing, setIsDesktopRefreshing] = useState(false);
  const pullStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const pullThreshold = 100; // px to exit recordings list
  const [isTouchInput, setIsTouchInput] = useState(false);
  const [recordingsListOpen, setRecordingsListOpen] = useState(false);
  const [transferScrollToPage, setTransferScrollToPage] = useState(false);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [isRecordingsListScrolling, setIsRecordingsListScrolling] = useState(false);
  const [recordingsListBottomVisible, setRecordingsListBottomVisible] = useState(false);
  const lastLoadedPageSizeRef = useRef<{ [streamId: string]: number }>({});
  const lastRecordingsListCloseTime = useRef<number>(0);
  const autoScrollUntilRef = useRef<number>(0);
  const keyboardTransitioningRef = useRef(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [forceSticky, setForceSticky] = useState(false);
  const [viewingRecordingsFrom, setViewingRecordingsFrom] = useState<Stream | null>(null);
  const [recordingBeingViewed, setRecordingBeingViewed] = useState<{ streamId: string, filename: string } | null>(null);
  const [recordingsListInView, setRecordingsListInView] = useState(true);
  const [lastVideoSize, setLastVideoSize] = useLocalStorageState('lastVideoSize', { width: 640, height: 360 });
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [showMobileLogout, setShowMobileLogout] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [openingRecording, setOpeningRecording] = useState(false);
  // --- Debug overlay state ---
  const [_, setDebugLongPressActive] = useState(false);
  const debugLongPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAtBottomOfPage, setIsAtBottomOfPage] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorModalMsg, setErrorModalMsg] = useState('');

  // Handler for copyright long-press (touch devices)
  function handleCopyrightTouchStart() {
    if (!isTouchInput) return;
    setDebugLongPressActive(true);
    debugLongPressTimeout.current = setTimeout(() => {
      setShowDebug(true);
      setDebugLongPressActive(false);
    }, 800); // 800ms long-press
  }
  function handleCopyrightTouchEnd() {
    setDebugLongPressActive(false);
    if (debugLongPressTimeout.current) {
      clearTimeout(debugLongPressTimeout.current);
      debugLongPressTimeout.current = null;
    }
  }

  // Filtered recordings
  const [isSearching, setIsSearching] = useState(false);
  const searchWorkerRef = useRef<Worker | null>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const lastSearchRequestId = useRef(0);
  const [userTyping, setUserTyping] = useState(false);
  const [searchInputActive, setSearchInputActive] = useState(false);
  const [filterUpdatesBlocked, setFilterUpdatesBlocked] = useState(false);
  const [searchToolsInteracting, setSearchToolsInteracting] = useState(false);

  const handleLogout = async () => {
    if (confirm('Are you sure you want to log out?')) {
      try {
        await logout();
      } catch (error) {
        console.error('Error during logout:', error);
        // Fallback: just clear storage and reload
        localStorage.removeItem('jwt');
        if (Capacitor.isNativePlatform()) await Preferences.remove({ key: 'refreshToken' });
        else await SecureStorage.removeRefreshToken();
        window.location.reload();
      }
    }
  };

  // Simplify the search worker initialization (remove the test message):
  useEffect(() => {
    if (typeof Worker !== 'undefined') {
      try {
        searchWorkerRef.current = new Worker('/searchWorker.js');

        searchWorkerRef.current.onmessage = (e) => {
          const { filtered, error, requestId } = e.data;

          if (requestId === lastSearchRequestId.current) {
            if (error) {
              console.error('Search worker error:', error);
              setFilteredRecordingsCache([]);
            } else {
              setFilteredRecordingsCache(filtered || []);
            }
            setIsSearching(false);
          }
        };

        searchWorkerRef.current.onerror = (error) => {
          console.error('Worker error:', error);
          searchWorkerRef.current = null;
          setIsSearching(false);
        };

      } catch (err: any) {
        console.error('Failed to create worker:', err);
        searchWorkerRef.current = null;
      }
    }

    return () => {
      if (searchWorkerRef.current) {
        searchWorkerRef.current.terminate();
      }
    };
  }, []);

  // Add a cache for filtered recordings
  const [filteredRecordingsCache, setFilteredRecordingsCache] = useState<Recording[]>([]);
  // Add this new state to store a "frozen" version of filtered recordings during typing
  const [frozenFilteredRecordings, setFrozenFilteredRecordings] = useState<Recording[]>([]);

  // Update the filteredRecordings useMemo in StreamPage.tsx:
  const filteredRecordings = useMemo(() => {
    const recordingsStream = viewingRecordingsFrom ?? activeStream;
    if (!recordingsStream) return [];

    const allCached = cachedRecordings[recordingsStream.id] ?? [];
    const notDeleted = deletedRecordings[recordingsStream.id] ?
      allCached.filter(rec => !deletedRecordings[recordingsStream.id].includes(rec.filename)) :
      allCached;

    // If user is actively typing and we have frozen results, return those to prevent DOM changes
    if (userTyping && frozenFilteredRecordings.length > 0) {
      // <-- PAGINATE frozen results
      return frozenFilteredRecordings
    }

    // If no search filters are active, return results immediately
    if ((!search || search.length < 2) && !isNicknamedOnly && !dateRange.from && !dateRange.to) {
      const sorted = notDeleted.sort((a, b) => b.filename.localeCompare(a.filename));
      return sorted;
    }

    // For searches, return cached results if available, otherwise perform immediate sync search
    if (filteredRecordingsCache.length > 0 || isSearching) {
      return filteredRecordingsCache;
    }

    // Fallback: perform immediate synchronous search if cache is empty
    const searchLower = search && search.length >= 2 ? search.toLowerCase() : null;

    const immediateResults = notDeleted.filter(rec => {
      const nickname = nicknames[rec.filename];

      // 1. Nicknamed filter - check this FIRST
      if (isNicknamedOnly && (!nickname || nickname.trim() === '')) {
        return false;
      }

      // 2. Search filter (only if 2+ characters)
      if (searchLower) {
        const hasNicknameMatch = nickname && nickname.toLowerCase().includes(searchLower);
        const hasFilenameMatch = rec.filename.toLowerCase().includes(searchLower);

        // Skip if NEITHER nickname NOR filename matches
        if (!hasNicknameMatch && !hasFilenameMatch) {
          return false;
        }
      }

      // 3. Date range filter
      if (dateRange.from || dateRange.to) {
        const match = rec.filename.match(/motion_(.+)\.mp4/);
        if (match) {
          const formattedFileDate = match[1].replace(
            /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
            (_m, h, m2, s, ms) => `T${h}:${m2}:${s}.${ms}Z`
          );

          try {
            const fileDateObj = new Date(formattedFileDate);
            const fileDateLocal = getLocalDateString(fileDateObj);

            if (dateRange.from && /^\d{4}-\d{2}-\d{2}$/.test(dateRange.from) && fileDateLocal < dateRange.from) return false;
            if (dateRange.to && /^\d{4}-\d{2}-\d{2}$/.test(dateRange.to) && fileDateLocal > dateRange.to) return false;
          } catch (dateError) {
            // If date parsing fails, exclude the recording
            return false;
          }
        }
      }

      return true;
    });

    // Sort and return immediate results
    return immediateResults
      .sort((a, b) => b.filename.localeCompare(a.filename))
  }, [
    cachedRecordings, nicknames, search,
    isNicknamedOnly, dateRange,
    activeStream, deletedRecordings, viewingRecordingsFrom,
    userTyping, frozenFilteredRecordings, filteredRecordingsCache,
    isSearching
  ]);

  // Update the effect that manages frozen results to handle stream changes:
  useEffect(() => {
    // Clear search state when no filters are active
    if ((!search || search.length < 2) && !isNicknamedOnly && !dateRange.from && !dateRange.to) {
      if (isSearching) {
        setIsSearching(false);
      }

      // Update frozen results for non-search case
      if (!userTyping) {
        const recordingsStream = viewingRecordingsFrom ?? activeStream;
        if (!recordingsStream) {
          setFrozenFilteredRecordings([]);
          return;
        }

        const allCached = cachedRecordings[recordingsStream.id] || [];
        const notDeleted = deletedRecordings[recordingsStream.id] ?
          allCached.filter(rec => !deletedRecordings[recordingsStream.id].includes(rec.filename)) :
          allCached;

        const sorted = notDeleted.sort((a, b) => b.filename.localeCompare(a.filename));
        setFrozenFilteredRecordings(sorted);
      }
    }
  }, [
    search, isNicknamedOnly, dateRange.from, dateRange.to,
    cachedRecordings, deletedRecordings, activeStream,
    viewingRecordingsFrom, userTyping, isSearching
  ]);

  // Add another useEffect to update frozen results when search results change
  useEffect(() => {
    // Store search results for freezing during typing
    if (!userTyping && filteredRecordingsCache.length > 0) {
      setFrozenFilteredRecordings(filteredRecordingsCache);
    }
  }, [filteredRecordingsCache, userTyping]);

  // Clean up the search effect:
  useEffect(() => {
    if (filterUpdatesBlocked) return;

    const recordingsStream = viewingRecordingsFrom ?? activeStream;
    if (!recordingsStream) {
      setFilteredRecordingsCache([]);
      setIsSearching(false);
      return;
    }

    const allCached = cachedRecordings[recordingsStream.id] || [];
    const notDeleted = deletedRecordings[recordingsStream.id] ?
      allCached.filter(rec => !deletedRecordings[recordingsStream.id].includes(rec.filename)) :
      allCached;

    if (((search && search.length >= 2) || isNicknamedOnly || dateRange.from || dateRange.to) && notDeleted.length > 0) {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      lastSearchRequestId.current++;
      const currentRequestId = lastSearchRequestId.current;
      const debounceDelay = (search && search.length >= 2) ? 300 : 100;

      searchTimeoutRef.current = window.setTimeout(() => {
        if (currentRequestId !== lastSearchRequestId.current) return;

        const currentRecordingsStream = viewingRecordingsFrom ?? activeStream;
        if (!currentRecordingsStream || currentRecordingsStream.id !== recordingsStream.id) return;

        // Use sync search on iOS, worker on other platforms
        if (isIOS() || !searchWorkerRef.current) {
          setIsSearching(true);
          performSearchSync(notDeleted, currentRequestId);
        } else {
          setIsSearching(true);
          searchWorkerRef.current.postMessage({
            recordings: notDeleted,
            nicknames,
            search: search.length >= 2 ? search : '',
            isNicknamedOnly,
            dateRange,
            requestId: currentRequestId
          });
        }
      }, debounceDelay);
    } else if ((search && search.length >= 2) || isNicknamedOnly || dateRange.from || dateRange.to) {
      setFilteredRecordingsCache([]);
      setIsSearching(false);
    } else {
      setFilteredRecordingsCache([]);
      setIsSearching(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [
    search, isNicknamedOnly, dateRange,
    cachedRecordings, nicknames, activeStream,
    deletedRecordings, viewingRecordingsFrom,
    filterUpdatesBlocked
  ]);

  // Also add a separate effect to clear search state when stream changes:
  useEffect(() => {
    // Clear search results when stream changes
    setFilteredRecordingsCache([]);
    setIsSearching(false);
    setFrozenFilteredRecordings([]);

    // Cancel any ongoing search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    lastSearchRequestId.current++;
  }, [activeStream?.id, viewingRecordingsFrom?.id]);

  // Update the performSearchSync function to accept and check request ID:
  const performSearchSync = (recordings: Recording[], requestId: number) => {
    // Use requestIdleCallback or setTimeout to chunk the work
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => {
        processSearchChunk(recordings, 0, [], requestId);
      });
    } else {
      setTimeout(() => {
        processSearchChunk(recordings, 0, [], requestId);
      }, 0);
    }
  };

  const processSearchChunk = (recordings: Recording[], startIndex: number, filtered: Recording[], requestId: number) => {
    // Check if this request was cancelled
    if (requestId !== lastSearchRequestId.current) {
      return; // Request was cancelled, stop processing
    }

    const CHUNK_SIZE = 500;
    const endIndex = Math.min(startIndex + CHUNK_SIZE, recordings.length);

    // Pre-process search term once
    const searchLower = search && search.length >= 2 ? search.toLowerCase() : null;

    for (let i = startIndex; i < endIndex; i++) {
      const rec = recordings[i];
      const nickname = nicknames[rec.filename];

      // 1. Nicknamed filter - check this FIRST
      if (isNicknamedOnly && (!nickname || nickname.trim() === '')) {
        continue;
      }

      // 2. Search filter (only if 2+ characters)
      if (searchLower) {
        const hasNicknameMatch = nickname && nickname.toLowerCase().includes(searchLower);
        const hasFilenameMatch = rec.filename.toLowerCase().includes(searchLower);

        // Skip if NEITHER nickname NOR filename matches
        if (!hasNicknameMatch && !hasFilenameMatch) {
          continue;
        }
      }

      // 3. Date range filter
      if (dateRange.from || dateRange.to) {
        const match = rec.filename.match(/motion_(.+)\.mp4/);
        if (match) {
          const formattedFileDate = match[1].replace(
            /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
            (_m, h, m2, s, ms) => `T${h}:${m2}:${s}.${ms}Z`
          );

          try {
            const fileDateObj = new Date(formattedFileDate);
            const fileDateLocal = getLocalDateString(fileDateObj);

            if (dateRange.from && /^\d{4}-\d{2}-\d{2}$/.test(dateRange.from) && fileDateLocal < dateRange.from) continue;
            if (dateRange.to && /^\d{4}-\d{2}-\d{2}$/.test(dateRange.to) && fileDateLocal > dateRange.to) continue;
          } catch (dateError) {
            // If date parsing fails, exclude the recording
            continue;
          }
        }
      }

      filtered.push(rec);
    }

    if (endIndex < recordings.length) {
      // More chunks to process
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => {
          processSearchChunk(recordings, endIndex, filtered, requestId);
        });
      } else {
        setTimeout(() => {
          processSearchChunk(recordings, endIndex, filtered, requestId);
        }, 0);
      }
    } else {
      // Check one final time before setting results
      if (requestId !== lastSearchRequestId.current) {
        return; // Request was cancelled
      }

      // Finished processing
      filtered.sort((a, b) => b.filename.localeCompare(a.filename));
      setFilteredRecordingsCache(filtered);
      setIsSearching(false);
    }
  };

  const { setLoading } = useLoading();

  // Update the loadStream function with proper HLS cleanup
  async function loadStream() {
    if (!videoRef.current || !activeStream) return console.warn('No video ref and/or active stream set');

    setIsLoadingStream(true);
    setLoading(true);

    // Store current video dimensions before loading new stream
    if (videoRef.current.clientWidth > 0 && videoRef.current.clientHeight > 0) {
      setLastVideoSize({
        width: videoRef.current.clientWidth,
        height: videoRef.current.clientHeight
      });

      // Apply the current dimensions to prevent flashing to small size
      videoRef.current.style.width = `100%`;
      videoRef.current.style.height = `${videoRef.current.clientHeight}px`;
    } else if (lastVideoSize.width > 0 && lastVideoSize.height > 0) {
      // Use last known dimensions if current dimensions aren't available
      videoRef.current.style.width = `$100%`;
      videoRef.current.style.height = `${lastVideoSize.height}px`;
    }

    // IMPORTANT: Cleanup existing HLS instance first to prevent buffer conflicts
    const existingHls = (videoRef.current as any)._hls;
    if (existingHls) {
      console.log('Cleaning up existing HLS instance');
      try {
        existingHls.destroy();
        delete (videoRef.current as any)._hls;
      } catch (error) {
        console.warn('Error cleaning up HLS instance:', error);
      }
    }

    // Clear video source to ensure clean state
    videoRef.current.src = '';
    videoRef.current.load();

    let url = `${API_BASE}/api/signed-stream-url/${activeStream.id}`;

    // Fetch signed URL from API
    try {
      const response = await fetchWithRetry(() => authFetch(url));
      url = `${API_BASE}${(await response.json()).url}`;
    } catch {
      console.error('Failed to fetch signed stream URL');
      setActiveStream(streams[0]);
      // Add timeout for consistent loading state behavior
      setTimeout(() => {
        setIsLoadingStream(false);
        setLoading(false);
      }, 100);
      return;
    }

    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isSafari) {
      videoRef.current.src = url;
      videoRef.current.load();
      videoRef.current.play().catch(() => { });

      // Safari-specific live seeking - wait for actual playback
      const video = videoRef.current;
      const handleCanPlay = () => {
        // Wait a bit more for Safari to actually start playing
        setTimeout(() => {
          if (video.duration && Number.isFinite(video.duration)) {
            video.currentTime = video.duration - 0.5;
          }
          setIsLoadingStream(false);
        }, 500);
      };

      video.addEventListener('canplay', handleCanPlay, { once: true });
    } else {
      try {
        if (Hls.isSupported()) {
          // Create fresh HLS instance with better error recovery
          const hls = new Hls({
            // Buffer management - more conservative for stream switching
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 5,
            liveDurationInfinity: true,
            enableWorker: true,
            lowLatencyMode: false, // Disable for initial load
            backBufferLength: 30, // Reduced back buffer
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 60 * 1000 * 1000,
            maxBufferHole: 0.5,

            // Loading settings
            manifestLoadingTimeOut: 10000,
            manifestLoadingMaxRetry: 3,
            manifestLoadingRetryDelay: 1000,

            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 3,
            fragLoadingRetryDelay: 1000,

            startLevel: -1,
            capLevelToPlayerSize: false,

            // Buffer append error recovery
            appendErrorMaxRetry: 3,

            // More aggressive error recovery
            highBufferWatchdogPeriod: 2,
            nudgeOffset: 0.1,
            nudgeMaxRetry: 5,

            liveBackBufferLength: 0,
          });

          let hasStartedPlaying = false;
          let initialSeekDone = false;

          hls.on(Hls.Events.ERROR, async (_event, data) => {
            console.log('HLS error:', data.type, data.details, data);

            // Check for 403 Forbidden on fragment/network errors
            if (
              data.type === Hls.ErrorTypes.NETWORK_ERROR &&
              data.response &&
              data.response.code === 403
            ) {
              console.warn('HLS 403 Forbidden: refreshing signed stream URL...');
              setIsLoadingStream(true);
              hls.destroy();
              delete (videoRef.current as any)._hls;
              // Fetch a new signed URL and reload the stream
              await loadStream();
              return;
            }

            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('Network error, reloading...');
                  setTimeout(() => loadStream(), 1000);
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('Media error, recovering...');
                  hls.recoverMediaError();
                  break;
                default:
                  console.log('Fatal error, destroying and recreating HLS...');
                  setIsLoadingStream(false);
                  hls.destroy();
                  setTimeout(() => loadStream(), 1000);
                  break;
              }
            } else {
              // Handle non-fatal errors
              switch (data.details) {
                case Hls.ErrorDetails.BUFFER_APPEND_ERROR:
                  console.log('Buffer append error, clearing buffers and restarting...');
                  try {
                    // Clear source buffers and restart
                    const video = videoRef.current;
                    if (video) {
                      hls.startLoad();
                    }
                  } catch (error) {
                    console.error('Error recovering from buffer append error:', error);
                    // Fallback: destroy and recreate
                    hls.destroy();
                    setTimeout(() => loadStream(), 500);
                  }
                  break;
                case Hls.ErrorDetails.BUFFER_STALLED_ERROR:
                  // Only seek to live if we've already started playing
                  if (hasStartedPlaying) {
                    console.log('Buffer stalled, jumping to live edge');
                    seekToLiveEdge(videoRef, hls);
                  }
                  break;
                case Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL:
                  console.log('Buffer nudge on stall');
                  break;
                default:
                  console.log('Non-fatal HLS error:', data.details);
                  break;
              }
            }
          });

          hls.loadSource(url);
          hls.attachMedia(videoRef.current);

          // Don't seek immediately on manifest parse - wait for actual playback
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('HLS manifest parsed for stream:', activeStream.id);
            // Don't set loading to false yet or seek - wait for playback
          });

          // Wait for the first fragment to be buffered AND playing
          const handleInitialPlayback = () => {
            const video = videoRef.current;
            if (!video || hasStartedPlaying) return;

            // Check if video is actually playing and has buffered content
            if (video.readyState >= 3 && !video.paused && video.currentTime > 0) {
              hasStartedPlaying = true;
              console.log('HLS initial playback started for stream:', activeStream.id);
              setIsLoadingStream(false);

              // Now do initial seek to live, but be less aggressive
              if (!initialSeekDone) {
                initialSeekDone = true;
                setTimeout(() => {
                  seekToLiveEdgeGentle(videoRef, hls);
                }, 1000); // Wait 1 second before seeking
              }
            }
          };

          // Check for initial playback on multiple events
          hls.on(Hls.Events.FRAG_BUFFERED, handleInitialPlayback);

          // Also check periodically until playback starts
          const playbackCheckInterval = setInterval(() => {
            if (hasStartedPlaying) {
              clearInterval(playbackCheckInterval);
              return;
            }
            handleInitialPlayback();
          }, 500);

          // Clean up interval after 10 seconds max
          setTimeout(() => {
            clearInterval(playbackCheckInterval);
            if (!hasStartedPlaying) {
              console.log('Fallback: setting loading to false after timeout for stream:', activeStream.id);
              setIsLoadingStream(false);
            }
          }, 10000);

          // Monitor buffer health, but only after initial playback
          hls.on(Hls.Events.FRAG_LOADED, () => {
            if (!hasStartedPlaying) return;

            const video = videoRef.current;
            if (video && hls.liveSyncPosition !== undefined) {
              const latency = hls.liveSyncPosition! - video.currentTime;

              // Be less aggressive - only jump if really far behind
              if (latency > 15) {
                console.log(`Latency too high (${latency.toFixed(1)}s), jumping to live`);
                seekToLiveEdge(videoRef, hls);
              }
            }
          });

          // Store HLS instance for cleanup
          (videoRef.current as any)._hls = hls;

        } else {
          // Fallback for browsers without HLS.js support
          videoRef.current.src = url;
          videoRef.current.load();
          videoRef.current.play().catch(() => { });

          const video = videoRef.current;
          const handleCanPlay = () => {
            // Wait for actual playback before seeking
            const checkPlayback = () => {
              if (video.readyState >= 3 && !video.paused && video.currentTime > 0) {
                setIsLoadingStream(false);
                setTimeout(() => {
                  seekToLive(videoRef);
                }, 1000);
              } else {
                setTimeout(checkPlayback, 200);
              }
            };
            checkPlayback();
          };

          video.addEventListener('canplay', handleCanPlay, { once: true });
        }
      } catch (err) {
        console.error('HLS.js failed, using native video:', err);
        videoRef.current.src = url;
        videoRef.current.load();
        videoRef.current.play().catch(() => { });

        const video = videoRef.current;
        const handleCanPlay = () => {
          const checkPlayback = () => {
            if (video.readyState >= 3 && !video.paused && video.currentTime > 0) {
              setIsLoadingStream(false);
              setTimeout(() => {
                seekToLive(videoRef);
              }, 1000);
            } else {
              setTimeout(checkPlayback, 200);
            }
          };
          checkPlayback();
        };

        video.addEventListener('canplay', handleCanPlay, { once: true });
      }
    }

    // Fetch signed thumb URLs after stream loads
    fetchSignedThumbUrls();
    fetchMasks();

    // Add a small delay before hiding loading state to prevent flickering
    setTimeout(() => {
      // setIsLoadingStream(false);
      setLoading(false);
    }, 100);
  }

  // Also update the cleanup effect to be more thorough
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video) {
        const hls = (video as any)._hls;
        if (hls) {
          console.log('Cleaning up HLS instance on component unmount');
          try {
            hls.destroy();
            delete (video as any)._hls;
          } catch (error) {
            console.warn('Error cleaning up HLS instance on unmount:', error);
          }
        }
        // Also clear video source
        video.src = '';
        video.load();
      }
    };
  }, []);

  // --- Helper function to get ordered streams ---
  const getOrderedStreams = (allStreams: Stream[], order: string[]): Stream[] => {
    if (order.length === 0) return allStreams; // Default API order

    const streamMap = new Map(allStreams.map(stream => [stream.id, stream]));
    const orderedStreams: Stream[] = [];

    // Add streams in the stored order
    order.forEach(id => {
      const stream = streamMap.get(id);
      if (stream) {
        orderedStreams.push(stream);
        streamMap.delete(id);
      }
    });

    // Add any new streams that aren't in the order yet
    streamMap.forEach(stream => orderedStreams.push(stream));

    return orderedStreams;
  };

  // --- Move active stream to front when it changes ---
  useEffect(() => {
    if (activeStream && streams.length > 0) {
      setStreamOrder(prevOrder => {
        // Remove the active stream from its current position
        const filteredOrder = prevOrder.filter(id => id !== activeStream.id);
        // Add it to the front
        return [activeStream.id, ...filteredOrder];
      });
    }
  }, [activeStream?.id, setStreamOrder]);

  // --- Update stream order when streams change ---
  useEffect(() => {
    if (streams.length > 0) {
      setStreamOrder(prevOrder => {
        // Keep existing order for streams that still exist
        const existingStreamIds = new Set(streams.map(s => s.id));
        const validOrder = prevOrder.filter(id => existingStreamIds.has(id));

        // Add any new streams that aren't in the order yet
        const newStreamIds = streams
          .map(s => s.id)
          .filter(id => !prevOrder.includes(id));

        return [...validOrder, ...newStreamIds];
      });
    }
  }, [streams, setStreamOrder]);

  // Open/close the popout menu when the user selects/deselects recordings
  useEffect(() => {
    if (selected.length > 0 && !menuOpen) {
      setMenuOpen(true);
    }
  }, [selected]);

  useEffect(() => {
    if (selected.length === 0 && menuOpen) {
      setMenuOpen(false);
    }
  }, [selected]);

  // Handle resize events to detect keyboard opening/closing
  useEffect(() => {
    let lastHeight = window.innerHeight;

    function handleResize() {
      const height = window.innerHeight;
      // If height shrinks by more than 100px, likely keyboard opened
      if (lastHeight - height > 100) {
        keyboardTransitioningRef.current = true;
        setIsKeyboardOpen(true);
        setTimeout(() => {
          keyboardTransitioningRef.current = false;
        }, 700); // Allow time for transition
      }
      // If height grows by more than 100px, likely keyboard closed
      else if (height - lastHeight > 100) {
        keyboardTransitioningRef.current = true;
        setIsKeyboardOpen(false);
        setTimeout(() => {
          keyboardTransitioningRef.current = false;
        }, 700);
      }
      lastHeight = height;
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Make autoScrollUntilRef available globally for SearchTools to access
    if (typeof window !== 'undefined') {
      (window as any).autoScrollUntilRef = autoScrollUntilRef;
    }

    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).autoScrollUntilRef;
      }
    };
  }, []);

  // Infinite scroll for recordings list
  useEffect(() => {
    const list = recordingsListRef.current;
    if (!list) return;

    function onScroll() {
      if (!activeStream) return;
      const recordingsStream = viewingRecordingsFrom ?? activeStream;

      const totalRemaining = (totalRecordings[recordingsStream.id] || 0) - (cachedRecordings[recordingsStream.id]?.length || 0);
      const isNearBottom = list!.scrollTop + list!.clientHeight >= list!.scrollHeight - 300;
      const shouldAutoLoad = totalRemaining > 50; // Auto-load when more than 50 recordings remain

      // Auto-load more recordings when scrolling near bottom (but not for the final 50)
      if (isNearBottom && shouldAutoLoad && !isLoadingMore) {
        const nextPage = currentPage + 1;
        const cachedLen = cachedRecordings[recordingsStream.id]?.length || 0;

        // Only load if we have more recordings to fetch
        if (cachedLen < (totalRecordings[recordingsStream.id] || 0)) {
          setIsLoadingMore(true);
          setCurrentPage(nextPage);
          loadPage(recordingsStream, nextPage, true).finally(() => {
            setIsLoadingMore(false);
          });
        }
      }

      // Existing fallback logic for when we reach the end unexpectedly
      if (
        list!.scrollTop + list!.clientHeight >= list!.scrollHeight - 10 &&
        lastLoadedPageSizeRef.current[recordingsStream.id] < PAGE_SIZE && // Only reset if last page was short
        (cachedRecordings[recordingsStream.id]?.length || 0) < (totalRecordings[recordingsStream.id] || 0)
      ) {
        // Reset cache and reload
        setCachedRecordings(prev => ({
          ...prev,
          [recordingsStream.id]: []
        }));
        setCurrentPage(1);
        setReachedLastSeen(false);
        loadPage(recordingsStream, 1, true);
        alert('Reached the end of the recordings list, and you\'re missing clips! Please forgive us while we reload the recordings list.');
      }
    }

    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, [cachedRecordings, activeStream, viewingRecordingsFrom, currentPage, totalRecordings, isLoadingMore]);

  useEffect(() => {
    const list = recordingsListRef.current;
    if (
      !list ||
      isLoadingMore ||
      !recordingsListOpen
    ) return;

    const recordingsStream = viewingRecordingsFrom ?? activeStream;
    if (!recordingsStream) return;

    // Check if more can be loaded
    const totalAvailable = totalRecordings[recordingsStream.id] || 0;
    const cachedLen = cachedRecordings[recordingsStream.id]?.length || 0;

    // If all loaded, do nothing
    if (cachedLen >= totalAvailable) return;

    // If the list is not scrollable (all content fits), or user is at bottom, load more
    const isScrollable = list.scrollHeight > list.clientHeight;
    const isAtBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 10;

    if (!isScrollable || isAtBottom) {
      // Load next page
      setIsLoadingMore(true);
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      loadPage(recordingsStream, nextPage, true).finally(() => {
        setIsLoadingMore(false);
      });
    }
  }, [
    filteredRecordings, // triggers when list changes
    isLoadingMore,
    recordingsListOpen,
    currentPage,
    totalRecordings,
    cachedRecordings,
    activeStream,
    viewingRecordingsFrom,
    loadPage,
    setCurrentPage
  ]);

  // Open the recordings list when swiping up at the bottom of the page
  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        setTouchStartY(e.touches[0].clientY);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (touchStartY !== null && e.changedTouches.length === 1) {
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        // Swiping up (deltaY negative enough) and at bottom of page
        if (
          deltaY < -30 &&
          window.innerHeight + window.scrollY >= document.body.offsetHeight - 8 &&
          !recordingsListOpen
        ) {
          setRecordingsListOpen(true);
          setTimeout(() => {
            const list = recordingsListRef.current;
            if (list) {
              const rect = list.getBoundingClientRect();
              const scrollY = window.scrollY || window.pageYOffset;
              const targetY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
              window.scrollTo({ top: targetY, behavior: 'smooth' });
            }
          }, 400);
        }
      }
      setTouchStartY(null);
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [touchStartY, recordingsListOpen]);

  // Auto-scroll to recordings list when at bottom of page
  useEffect(() => {
    if (!recordingsListOpen) return;

    function checkAndScrollToRecordingsList() {
      if (Date.now() < autoScrollUntilRef.current) return; // Ignore scroll events while auto-scrolling
      // If user is at (or very near) the bottom of the page
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 8) {
        const list = recordingsListRef.current;
        if (list) {
          const rect = list.getBoundingClientRect();
          const scrollY = window.scrollY || window.pageYOffset;
          const targetY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        }
      }
    }

    // Run once on open
    checkAndScrollToRecordingsList();

    // Also run on resize (in case of orientation change)
    window.addEventListener('touchmove', checkAndScrollToRecordingsList, { passive: true });
    window.addEventListener('resize', checkAndScrollToRecordingsList);

    return () => {
      window.removeEventListener('scroll', checkAndScrollToRecordingsList);
      window.removeEventListener('resize', checkAndScrollToRecordingsList);
    };
  }, [recordingsListOpen]);

  // Auto open recordings list when scrolled to bottom
  useEffect(() => {
    let lastScrollY = window.scrollY;

    function handleScroll() {
      const scrollTop = window.scrollY || window.pageYOffset;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;

      // Calculate how close to bottom (in pixels from bottom)
      const distanceFromBottom = documentHeight - (scrollTop + windowHeight);
      const bottomThreshold = windowHeight * 0.5; // 50% of viewport height

      setIsAtBottomOfPage(distanceFromBottom <= bottomThreshold);

      if (keyboardTransitioningRef.current || isKeyboardOpen || forceSticky) return;
      const currentScrollY = window.scrollY;
      if ((currentScrollY > lastScrollY)) {
        if (
          window.innerHeight + window.scrollY >= document.body.offsetHeight - 32 &&
          !recordingsListOpen &&
          Date.now() - lastRecordingsListCloseTime.current > 1000
        ) {
          setRecordingsListOpen(true);
          setTimeout(() => {
            const list = recordingsListRef.current;
            if (list) {
              const rect = list.getBoundingClientRect();
              const scrollY = window.scrollY || window.pageYOffset;
              const targetY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
              setTimeout(() => recordingsListRef.current?.scrollTo(0, 0), 450);
              window.scrollTo({ top: targetY, behavior: 'smooth' });
            }
          }, 400);
        } else if (recordingsListOpen) {
          const list = recordingsListRef.current;
          if (list) {
            const rect = list.getBoundingClientRect();
            const halfway = rect.height / 2;
            if (rect.top < window.innerHeight / 2 - halfway) {
              const scrollY = window.scrollY || window.pageYOffset;
              const targetY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
              autoScrollUntilRef.current = Date.now() + 700;
              window.scrollTo({ top: targetY, behavior: 'smooth' });
            }
          }
        }
      }
      lastScrollY = currentScrollY;
    }

    // iOS momentum scroll fix: check at touchend and after a short delay
    function handleTouchEnd() {
      setTimeout(() => {
        const atBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 32;
        if (
          atBottom &&
          !recordingsListOpen &&
          Date.now() - lastRecordingsListCloseTime.current > 1000
        ) {
          setRecordingsListOpen(true);
          setTimeout(() => {
            const list = recordingsListRef.current;
            if (list) {
              const rect = list.getBoundingClientRect();
              const scrollY = window.scrollY || window.pageYOffset;
              const targetY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
              setTimeout(() => recordingsListRef.current?.scrollTo(0, 0), 450);
              window.scrollTo({ top: targetY, behavior: 'smooth' });
            }
          }, 400);
        }
      }, 200); // Short delay to allow momentum scroll to finish
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [recordingsListOpen]);
  useEffect(() => {
    let lastScrollY = window.scrollY;

    function handleScroll() {
      const currentScrollY = window.scrollY;

      // 1. Suppress closing for 1s after opening the list
      if (
        Date.now() - lastRecordingsListCloseTime.current < 1000 ||
        keyboardTransitioningRef.current ||
        isKeyboardOpen ||
        forceSticky ||
        Date.now() < autoScrollUntilRef.current ||
        searchToolsInteracting
      ) {
        lastScrollY = currentScrollY;
        return;
      }

      // 2. Only close if scrolling up by at least 20px
      const scrollDelta = lastScrollY - currentScrollY;
      if (
        gridOuterRef.current?.scrollTop === 0 && // <-- Only close if grid is also at top
        scrollDelta > 20 &&
        window.innerHeight + currentScrollY < document.body.offsetHeight - window.innerHeight * 0.1 &&
        recordingsListOpen
      ) {
        setRecordingsListOpen(false);
        setTransferScrollToPage(false);
        lastRecordingsListCloseTime.current = Date.now();
        setTimeout(() => {
          window.scrollTo({ behavior: 'smooth', top: 0 });
        }, 450);
      }
      lastScrollY = currentScrollY;
    }

    if (recordingsListOpen) {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [recordingsListOpen, searchToolsInteracting, isKeyboardOpen, forceSticky]);

  // For scrolling behavior, we need to set the sticky state based on scroll position
  useEffect(() => {
    function updateSticky() {
      if (keyboardTransitioningRef.current || isMobileWidth) {
        // console.warn(`Skipping sticky update ${keyboardTransitioningRef.current ? 'due to keyboard transition' : 'on mobile'}`);
        return; // Add isMobile check
      }

      const sentinel = searchStickySentinelRef.current;
      if (!sentinel) return;
      const rect = sentinel.getBoundingClientRect();
      if (!lastStickyRef.current && rect.top < 20) {
        setSearchSticky(true);
        lastStickyRef.current = true;
      } else if (lastStickyRef.current && rect.top > 40) {
        setSearchSticky(false);
        lastStickyRef.current = false;
      }
    }

    // IntersectionObserver for fast transitions
    const sentinel = searchStickySentinelRef.current;
    let observer: IntersectionObserver | null = null;
    if (sentinel && !isMobileWidth) { // Add !isMobile check
      observer = new window.IntersectionObserver(
        updateSticky,
        { threshold: 0 }
      );
      observer.observe(sentinel);
    }

    // Scroll event for pixel-perfect updates
    window.addEventListener('scroll', updateSticky, { passive: true });
    window.addEventListener('resize', updateSticky, { passive: true });

    return () => {
      window.removeEventListener('scroll', updateSticky);
      window.removeEventListener('resize', updateSticky);
      if (observer && sentinel) observer.disconnect();
    };
  }, [isMobileWidth]); // Add isMobile as dependency

  // Update the mobile sticky effect:
  useEffect(() => {
    function updateMobileSticky() {
      if (keyboardTransitioningRef.current || forceSticky || !isMobileWidth) {
        // console.warn(`Skipping sticky update ${keyboardTransitioningRef.current ? 'due to keyboard transition' : 'on desktop'}`);
        return; // Add !isMobile check
      }
      const sentinel = mobileSearchStickySentinelRef.current;
      if (!sentinel) return;
      const rect = sentinel.getBoundingClientRect();
      if (!lastMobileStickyRef.current && rect.top < 20) {
        setMobileSearchSticky(true);
        lastMobileStickyRef.current = true;
      } else if (lastMobileStickyRef.current && rect.top > 40) {
        setMobileSearchSticky(false);
        lastMobileStickyRef.current = false;
      }
    }

    const sentinel = mobileSearchStickySentinelRef.current;
    let observer: IntersectionObserver | null = null;
    if (sentinel && isMobileWidth) { // Add isMobile check
      observer = new window.IntersectionObserver(
        updateMobileSticky,
        { threshold: 0 }
      );
      observer.observe(sentinel);
    }

    window.addEventListener('scroll', updateMobileSticky, { passive: true });

    return () => {
      if (observer && sentinel) observer.disconnect();
      window.removeEventListener('scroll', updateMobileSticky);
    };
  }, [isMobileWidth]); // Add isMobile as dependency

  // Focus recordings list when the bottom sentinel is intersected
  useEffect(() => {
    const sentinel = recordingsListBottomSentinelRef.current;
    const list = recordingsListRef.current;
    if (!sentinel || !list) return;

    const observer = new window.IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          setRecordingsListBottomVisible(entry.isIntersecting);
          if (entry.isIntersecting) {
            // Smoothly focus the recordings list
            list.focus({ preventScroll: true });
          }
        });
      },
      {
        root: null, // viewport
        threshold: 0.1, // Adjust as needed
      }
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const list = recordingsListRef.current;
    if (!list) return;

    const observer = new window.IntersectionObserver(
      (entries) => {
        setRecordingsListInView(entries[0].isIntersecting);
      },
      {
        root: null, // viewport
        threshold: 0.1,
      }
    );
    observer.observe(list);

    return () => observer.disconnect();
  }, [recordingsListRef, recordingsListOpen]);

  useEffect(() => {
    if (!isTouchInput && recordingsListBottomVisible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isTouchInput, recordingsListBottomVisible]);

  useEffect(() => {
    const handleTouch = () => setIsTouchInput(true);
    const handleMouse = () => setIsTouchInput(false);

    window.addEventListener('touchstart', handleTouch, { passive: true });
    window.addEventListener('mousemove', handleMouse, { passive: true });
    window.addEventListener('keydown', handleMouse, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouch);
      window.removeEventListener('mousemove', handleMouse);
      window.removeEventListener('keydown', handleMouse);
    };
  }, []);

  // Reset recordings and pagination state when stream changes
  useEffect(() => {
    // Calculate how many pages are already cached for this stream
    const recordingsStream = viewingRecordingsFrom ?? activeStream;
    const cachedLen = recordingsStream ? cachedRecordings[recordingsStream.id]?.length || 0 : 0;
    const initialPage = Math.max(1, Math.ceil(cachedLen / PAGE_SIZE));
    setCurrentPage(initialPage);
    setReachedLastSeen(!recordingsStream); // reachedLastSeen is false if activeStream is set, true if not
    // Fetch the first page of recordings
    if (recordingsStream) loadPage(recordingsStream, 1, true);
  }, [activeStream, viewingRecordingsFrom]);

  // 1. --- Load stream video on stream change ---
  useEffect(() => {
    if (!activeStream) return;
    localStorage.setItem('activeStreamId', activeStream.id);
    loadStream();
  }, [activeStream]);

  useEffect(() => {
    if (!isVideoPaused) seekToLive(videoRef);
  }, [isVideoPaused]);

  // 2. --- Set recordings list items depending on current page or (search filter) date range ---
  useEffect(() => {
    let cancelled = false;
    let preCacheTimeout: ReturnType<typeof setTimeout> | null = null;
    let preCacheInterval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      // Poll latest recordings every 5 seconds
      const pollLatest = async () => {
        console.log('Polling latest recordings...');
        if (!activeStream || cancelled) return;

        const today = getLocalDateString(new Date());
        // 3. --- Poll recordings and nicknames every 10 seconds if needed ---
        const shouldPoll =
          (!dateRange.from && !dateRange.to) ||
          (dateRange.from && !dateRange.to && dateRange.from <= today) ||
          (!dateRange.from && dateRange.to && today <= dateRange.to) ||
          (dateRange.from && dateRange.to && dateRange.from <= today && today <= dateRange.to);

        const recordingsStream = viewingRecordingsFrom ?? activeStream;

        if (shouldPoll) await pollLatestRecordings(recordingsStream, cancelled);
        else console.log('Skipping latest recordings poll due to date range');

        // After 5s, try to pre-cache more pages if needed
        if (preCacheTimeout) clearTimeout(preCacheTimeout);
        preCacheTimeout = setTimeout(async () => {
          if (cancelled || !activeStream) return;

          // Only pre-cache if we have more to fetch
          const recordingsStream = viewingRecordingsFrom ?? activeStream;
          const cachedLen = cachedRecordings[recordingsStream.id]?.length || 0;
          const total = totalRecordings[recordingsStream.id] || 0;

          if (cachedLen < total) {
            // Fetch the next page
            const nextPage = Math.ceil(cachedLen / PAGE_SIZE) + 1;
            const nextPageState = currentPage + 1;
            if (nextPage < nextPageState) return; // Don't pre-cache if we're somehow past the next page
            if (isLoadingMore) return; // Don't pre-cache if already loading more
            if (nextPage > 100) return; // Don't pre-cache too many pages

            console.log(`Pre-caching page ${nextPage} for stream ${recordingsStream.id}`);
            setIsLoadingMore(true);
            setCurrentPage(nextPage);
            await loadPage(recordingsStream, nextPage, true);
            setIsLoadingMore(false);
          }
        }, 5000);
      };

      preCacheInterval = setInterval(pollLatest, 5000);
    })();

    return () => {
      cancelled = true;
      if (preCacheTimeout) clearTimeout(preCacheTimeout);
      if (preCacheInterval) clearInterval(preCacheInterval);
    };
  }, [
    // Only include dependencies that should trigger a restart of the polling
    dateRange.from,
    dateRange.to,
    activeStream?.id,
    viewingRecordingsFrom?.id
    // Removed: cachedRecordings, totalRecordings, currentPage, isLoadingMore
    // These change frequently and shouldn't restart the polling interval
  ]);

  // Fetch a page of recordings
  async function loadPage(stream: Stream, page: number, force = false) {
    if ((reachedLastSeen && !force) || !activeStream) {
      return;
    }

    const res = await authFetch(`${API_BASE}/api/recordings/${stream.id}/${page}`);
    if (!res.ok) return;
    const data = await res.json();
    const newRecs: Recording[] = (data.recordings || []).map((rec: any) => ({
      filename: rec.filename,
      streamId: stream.id
    }));

    // Handle deleted recordings from server
    if (data.deletedRecordings && Array.isArray(data.deletedRecordings)) {
      setDeletedRecordings(prev => ({
        ...prev,
        [stream.id]: [...new Set([...(prev[stream.id] || []), ...data.deletedRecordings])]
      }));
    }

    setTotalRecordings(prev => ({ ...prev, [stream.id]: data.total || 0 }));

    let foundLastSeen = false;
    let recsToAdd = newRecs;
    if (lastSeenRecording[stream.id]) {
      const idx = newRecs.findIndex(r => r.filename === lastSeenRecording[stream.id]!);
      if (idx !== -1) {
        foundLastSeen = true;
      } else if (
        newRecs.length > 0 &&
        newRecs[newRecs.length - 1].filename.localeCompare(lastSeenRecording[stream.id]!) < 0
      ) {
        foundLastSeen = true;
      }
    }
    lastLoadedPageSizeRef.current[stream.id] = recsToAdd.length;

    setCachedRecordings(prev => {
      const prevList = prev[stream.id] || [];
      const all = [...prevList, ...recsToAdd];
      const seen = new Set<string>();
      const deduped = all.filter(r => {
        if (seen.has(r.filename)) return false;
        seen.add(r.filename);
        return true;
      });
      return { ...prev, [stream.id]: deduped.sort((a, b) => b.filename.localeCompare(a.filename)) };
    });

    if ((recsToAdd.length < PAGE_SIZE) || foundLastSeen) {
      setReachedLastSeen(true);
    }
  }

  async function pollLatestRecordings(stream: Stream, cancelled?: boolean) {
    if (!activeStream) return;
    try {
      const res = await authFetch(`${API_BASE}/api/latest-recordings/${stream.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const newRecs: Recording[] = (data.recordings || []).map((filename: string) => ({
        filename,
        streamId: stream.id
      }));

      // Handle new deleted recordings
      if (data.deletedRecordings && Array.isArray(data.deletedRecordings) && data.deletedRecordings.length > 0) {
        setDeletedRecordings(prev => ({
          ...prev,
          [stream.id]: [...new Set([...(prev[stream.id] || []), ...data.deletedRecordings])]
        }));
      }

      if (!cancelled && newRecs.length > 0) {
        setLastSeenRecording(prev => ({ ...prev, [stream.id]: newRecs[0].filename }));
        setCachedRecordings(prev => {
          const prevList = prev[stream.id] || [];
          const all = [...newRecs, ...prevList];
          const seen = new Set<string>();
          const deduped = all.filter(r => {
            if (seen.has(r.filename)) return false;
            seen.add(r.filename);
            return true;
          });
          return { ...prev, [stream.id]: deduped.sort((a, b) => b.filename.localeCompare(a.filename)) };
        });
      }
    } catch (err) {
      console.error('Failed to poll latest recordings:', err);
    }
  }

  // --- Poll motion status every second ---
  // Update the motion status polling effect to include sound playing logic
  useEffect(() => {
    if (!activeStream) return;

    const pollMotionStatus = () => {
      if (!activeStream) return;
      authFetch(`${API_BASE}/api/motion-status`)
        .then(res => res.json())
        .then((status: { [streamId: string]: { recording: boolean, secondsLeft: number, saving: boolean, startedRecordingAt: number } }) => {
          setMotionStatus(status);

          // Check for any stream that just started recording (motion detection)
          for (const [streamId, s] of Object.entries(status)) {
            const recordingJustStarted = s.recording && Date.now() - s.startedRecordingAt < 1000; // 1 second threshold

            // Play sound when ANY stream starts recording
            if (recordingJustStarted) {
              console.log(`Motion detected on stream ${streamId}, playing sound`);
              playMotionSound();
              break; // Only play once even if multiple streams start recording simultaneously
            }
          }
        })
        .catch(() => setMotionStatus({}));
    };

    pollMotionStatus();
    const interval = setInterval(pollMotionStatus, 1000);
    return () => clearInterval(interval);
  }, [activeStream]);



  // Update the stream switch effect to be simpler and more reliable
  useEffect(() => {
    if (!activeStream?.id) return;

    // Check if we just switched to a stream that recently started recording
    const streamStatus = motionStatus[activeStream.id];

    if (streamStatus?.recording && streamStatus.startedRecordingAt > 0) {
      const timeSinceStart = Date.now() - streamStatus.startedRecordingAt;

      if (timeSinceStart <= 1000) { // 1 second
        console.log(`Switched to stream ${activeStream.id} that recently started recording (${Math.floor(timeSinceStart / 1000)}s ago)`);
        playMotionSound();
      } else {
        console.log(`Switched to stream ${activeStream.id} that started recording ${Math.floor(timeSinceStart / 1000)}s ago (too old)`);
      }
    } else {
      console.log(`Switched to stream ${activeStream.id} - not recording or no start time`);
    }
  }, [activeStream?.id]); // Remove motionStatus dependency to only trigger on stream changes
  // Add the playMotionSound function
  const playMotionSound = () => {
    console.log('Playing motion sound...');

    if (isIOS()) {
      const audio = new Audio('/sounds/recording-started.mp3');
      audio.volume = 0.3;
      const playPromise = audio.play();
      if (playPromise) {
        playPromise
          .then(() => {
            console.log('Motion notification sound played successfully');
          })
          .catch(error => {
            console.log('Motion notification sound blocked:', error);
            try {
              playNotificationTone();
            } catch (e) {
              console.log('Notification tone fallback failed:', e);
            }
          });
      }
    } else {
      const audio = new Audio('/sounds/recording-started.mp3');
      audio.play()
        .then(() => {
          console.log('Motion notification sound played successfully');
        })
        .catch((error) => {
          console.log('Motion notification sound failed to play:', error);
        });
    }
  };
  // Add periodic live edge monitoring
  useEffect(() => {
    if (!activeStream || isVideoPaused) return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      const hls = video ? (video as any)._hls : null;

      if (
        video &&
        hls &&
        hls.liveSyncPosition !== undefined &&
        !isVideoPaused
      ) {
        const latency = hls.liveSyncPosition - video.currentTime;
        if (latency > 12 && video.readyState >= 3 && video.currentTime > 10) {
          console.log(`Auto-correcting high latency: ${latency.toFixed(1)}s`);
          seekToLiveEdge(videoRef, hls);
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [activeStream, isVideoPaused]);

  useEffect(() => {
    const video = videoRef.current;
    const hls = video ? (video as any)._hls : null;

    if (!hls) return;
    if (isVideoPaused) {
      hls.stopLoad();
    } else {
      hls.startLoad();
    }
  }, [isVideoPaused]);

  // Add cleanup for HLS instance
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      const hls = video ? (video as any)._hls : null;
      if (hls) {
        hls.destroy();
        delete (video as any)._hls;
      }
    };
  }, []);

  // --- Poll pause state every 3 seconds ---
  useEffect(() => {
    if (!activeStream) return;
    const pollPauseState = () => {
      if (!activeStream) return;
      authFetch(`${API_BASE}/api/motion-pause`)
        .then(res => res.json())
        .then(data => {
          setMotionRecordingPaused(data);
        })
        .catch(() => { });
    }
    pollPauseState();
    const interval = setInterval(pollPauseState, 3000);
    return () => clearInterval(interval);
  }, [streams]);

  // --- Scroll to recordings if needed ---
  useEffect(() => {
    if (location.state) {
      const state = (location.state as any)

      // If scrollToRecordings is true, scroll to recordings list
      if (state.scrollToRecordings && recordingsListRef.current) {
        setTimeout(() => {
          recordingsListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.history.replaceState(
            { ...state, scrollToRecordings: false },
            ''
          );
        }, 50);
      }
      // If streamId is provided in state, set active stream
      if (state.streamId) {
        const streamId = state.streamId;
        window.history.replaceState(
          { ...state, streamId: undefined },
          ''
        );
        if (streams[streamId]) setActiveStream(streams[streamId]);
      }

      if (state.deletedFilename) {
        handleImmediateDeleteUpdate([state.deletedFilename]);

        // Optionally, clear the deletedFilename from state so it doesn't repeat
        window.history.replaceState(
          { ...state, deletedFilename: undefined },
          ''
        );
      }

      if (state.recordingBeingViewed) {
        const { streamId, filename } = state.recordingBeingViewed;
        setOpeningRecording(true);
        setRecordingBeingViewed({ streamId, filename });
        setOpeningRecording(false);
        if (!viewed.find(viewed => viewed.filename === filename && viewed.streamId === streamId)) {
          const updated = [...viewed, { filename, streamId }];
          setViewed(updated);
        }
        window.history.replaceState(
          { ...state, recordingBeingViewed: undefined },
          ''
        );
      }
    }
  }, [location.state, streams]);

  useEffect(() => {
    if ((isRecordingsListScrolling || pullDistance) && longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  }, [isRecordingsListScrolling, longPressTimeout, pullDistance]);

  useEffect(() => {
    function handleResize() {
      setIsMobileWidth(window.innerWidth < 600);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Add a separate effect to handle mode changes and reset sticky states
  useEffect(() => {
    // Reset both sticky states when mode changes
    setSearchSticky(false);
    setMobileSearchSticky(false);
    lastStickyRef.current = false;
    lastMobileStickyRef.current = false;
  }, [isMobileWidth]);

  const handleView = (filename: string) => {
    if (!activeStream) return;
    const recordingsStream = viewingRecordingsFrom ?? activeStream;
    setOpeningRecording(true);
    setRecordingBeingViewed({ streamId: recordingsStream.id, filename });
    autoScrollUntilRef.current = Date.now() + 1000;
    setTimeout(() => {
      setOpeningRecording(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 700); // match controls bar animation duration
    if (!viewed.find(viewed => viewed.filename === filename && viewed.streamId === recordingsStream.id)) {
      const updated = [...viewed, { filename, streamId: recordingsStream.id }];
      setViewed(updated);
    }
  };

  // Handle checkbox long-press for selecting recordings
  function handleTouchStart(filename: string, checked: boolean) {
    if (isRecordingsListScrolling) return; // Don't start long-press if scrolling
    longPressTimeout.current = setTimeout(() => {
      if (!checked && recordingsListOpen) {
        handleCheckboxChange(filename, true);
      }
    }, 500); // 500ms for long press
  }

  function handleTouchEnd() {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  }

  function handleCheckboxChange(filename: string, checked: boolean) {
    let updated: string[];
    if (checked) {
      updated = [...selected, filename];
    } else {
      updated = selected.filter(f => f !== filename);
    }
    setSelected(updated);
  }

  // --- Push notifications toggle effect ---
  // Only disable notifications (setShouldNotifyOnMotion(false)) if the user toggles the switch OFF.
  // If the user toggles ON but denies permission, just leave the toggle ON and show an error/toast if desired.

  useEffect(() => {
    setTimeout(async () => {
      if (!isLoadingMotionNotifications) {
        return;
      }

      if (shouldNotifyOnMotion) {
        // Enable notifications (user toggled ON)
        if (Capacitor.getPlatform() !== 'web') {
          // Native mobile platforms
          try {
            await setupPushNotifications();
          } catch (err) {
            console.error('Failed to enable push notifications:', err);
            setErrorModalMsg('Failed to enable motion notifications. Please check your device settings.');
            setErrorModalOpen(true);
            setIsLoadingMotionNotifications(false);
            setShouldNotifyOnMotion(false);
          }
        } else {
          // Web platform
          if (!navigator.serviceWorker) {
            setIsLoadingMotionNotifications(false);
            setShouldNotifyOnMotion(false);
            setErrorModalMsg('Service Worker not supported. Please use a modern browser to enable notifications.');
            setErrorModalOpen(true);
            return console.warn('Service Worker not supported');
          }
          const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
          if (permission !== 'granted') {
            console.warn('Notification permission not granted');
            setIsLoadingMotionNotifications(false);
            setShouldNotifyOnMotion(false);
            setErrorModalMsg('Notification permission not granted.');
            setErrorModalOpen(true);
            return;
          }
          try {
            await subscribeToWebPush();
          } catch (err) {
            console.error('Failed to subscribe to web push:', err);
            // Reminder to install as PWA
            setIsLoadingMotionNotifications(false);
            setShouldNotifyOnMotion(false);
            setErrorModalMsg(
              'Failed to enable motion notifications. For best results, install this app as a PWA from your browser menu.'
            );
            setErrorModalOpen(true);
          }
        }
      } else {
        // Disable notifications (user toggled OFF)
        if (Capacitor.getPlatform() === 'web') {
          // Web platform
          if (!navigator.serviceWorker) {
            setIsLoadingMotionNotifications(false);
            setShouldNotifyOnMotion(false);
            setErrorModalMsg('Service Worker not supported. Please use a modern browser to enable notifications.');
            setErrorModalOpen(true);
            return console.warn('Service Worker not supported');
          }
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await authFetch(`${API_BASE}/api/unsubscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sub),
            });
            await sub.unsubscribe();
          }
        } else {
          // Native mobile platforms
          await authFetch(`${API_BASE}/api/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fcmToken: true }),
          });
          await PushNotifications.removeAllListeners();
          await MotionService.stopService();
        }
      }

      setIsLoadingMotionNotifications(false);
    }, 1000); // Wait 1 second to allow UI to update
  }, [shouldNotifyOnMotion]);

  // Attach event listeners to the video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsVideoPaused(false);
    const handlePause = () => setIsVideoPaused(true);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    // Set initial state
    setIsVideoPaused(video.paused);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [videoRef]);

  // --- Signed thumbnail logic ---
  function fetchSignedThumbUrls() {
    Object.values(streams).forEach(stream => {
      const entry = signedThumbUrls[stream.id];
      const now = Math.floor(Date.now() / 1000);
      // Only fetch if missing or expiring soon
      if (!entry || entry.expires < now + 10) {
        fetchWithRetry(() => authFetch(`${API_BASE}/api/signed-latest-thumb-url/${stream.id}`)
        ).then(async response => {
          const data = await response.json();
          if (data.url) {
            const match = data.url.match(/[?&]expires=(\d+)/);
            const expires = match ? parseInt(match[1], 10) : now + 300;
            setSignedThumbUrls(existing => ({
              ...existing,
              [stream.id]: { url: API_BASE + data.url, expires }
            }));
          }
        }).catch(err => { console.error('Failed to fetch signed thumb URL:', err); });
      }
    });
  }

  // Update live thumbnails every 5 seconds, but only fetch if needed
  useEffect(() => {
    fetchSignedThumbUrls(); // Fetch immediately

    const interval = setInterval(() => {
      // Always fetch if missing or expiring soon
      fetchSignedThumbUrls();
    }, 5000);
    (window as any)._thumbInterval = interval;

    return () => {
      if ((window as any)._thumbInterval) clearInterval((window as any)._thumbInterval);
    };
  }, [activeStream]);

  useEffect(() => {
    if (!activeStream) return;
    const recordingsStream = viewingRecordingsFrom ?? activeStream;
    authFetch(`${API_BASE}/api/recordings-nicknames/${recordingsStream.id}`)
      .then(res => res.json())
      .then((nicknamedRecordings: Array<{ filename: string; nickname: string }>) =>
        setNicknames(nicknamedRecordings.reduce((acc: Record<string, string>, rec) => {
          acc[rec.filename] = rec.nickname; return acc;
        }, {})))
      .catch(() => setNicknames({}));
  }, [activeStream, viewingRecordingsFrom])

  // Deleted recordings polling
  useEffect(() => {
    if (!activeStream) return;

    let cancelled = false;
    async function fetchDeleted() {
      if (!activeStream) return;
      const recordingsStream = viewingRecordingsFrom ?? activeStream;
      try {
        const res = await authFetch(`${API_BASE}/api/deleted-recordings/${recordingsStream.id}`);
        if (!res.ok) return;
        const list: string[] = await res.json();
        if (!cancelled && (!deletedRecordings[recordingsStream.id] || !list.every(r => deletedRecordings[recordingsStream.id].includes(r)))) {
          setDeletedRecordings(prev => ({ ...prev, [recordingsStream.id]: list }));
        }
      } catch { }
    }
    fetchDeleted();
    const interval = setInterval(fetchDeleted, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeStream, viewingRecordingsFrom]);

  function handleImmediateDeleteUpdate(deletedFilenames: string[]) {
    if (!activeStream) return;

    const viewingStream = viewingRecordingsFrom ?? activeStream;

    // Remove from cachedRecordings
    setCachedRecordings(prev => {
      const updated = (prev[viewingStream.id] || []).filter(r => !deletedFilenames.includes(r.filename));
      return { ...prev, [viewingStream.id]: updated.sort((a, b) => b.filename.localeCompare(a.filename)) };
    });

    // Remove from selected
    setSelected(prev => prev.filter(f => !deletedFilenames.includes(f)));

    // Update lastSeenRecording if it was deleted
    setLastSeenRecording(prev => {
      const currentLastSeen = prev[viewingStream.id];
      if (currentLastSeen && deletedFilenames.includes(currentLastSeen)) {
        // Find the next most recent recording that wasn't deleted
        const remainingRecordings = (cachedRecordings[viewingStream.id] || [])
          .filter(r => !deletedFilenames.includes(r.filename))
          .sort((a, b) => b.filename.localeCompare(a.filename));

        const newLastSeen = remainingRecordings.length > 0 ? remainingRecordings[0].filename : null;
        return { ...prev, [viewingStream.id]: newLastSeen };
      }
      return prev;
    });
  }

  // New deleted recordings received from the server
  useEffect(() => {
    if (Object.values(deletedRecordings).every(d => d.length === 0) || !activeStream) return;

    // Update cached recordings
    setCachedRecordings(prev => {
      // For each stream, remove deleted recordings from its cached recordings
      const updatedPrev = { ...prev };
      Object.entries(deletedRecordings).forEach(([streamId, deletedList]) => {
        const cached = prev[streamId] || [];
        const updated = cached.filter(r => !deletedList.includes(r.filename));
        updatedPrev[streamId] = updated.sort((a, b) => b.filename.localeCompare(a.filename));
      });
      return updatedPrev;
    });

    // Update lastSeenRecording for affected streams
    setLastSeenRecording(prev => {
      const updatedPrev = { ...prev };
      Object.entries(deletedRecordings).forEach(([streamId, deletedList]) => {
        const currentLastSeen = prev[streamId];
        if (currentLastSeen && deletedList.includes(currentLastSeen)) {
          // Find the next most recent recording that wasn't deleted
          const remainingRecordings = (cachedRecordings[streamId] || [])
            .filter(r => !deletedList.includes(r.filename))
            .sort((a, b) => b.filename.localeCompare(a.filename));

          const newLastSeen = remainingRecordings.length > 0 ? remainingRecordings[0].filename : null;
          updatedPrev[streamId] = newLastSeen;
        }
      });
      return updatedPrev;
    });
  }, [deletedRecordings, cachedRecordings]);


  async function fetchMasks() {
    // Skip fetching if paused
    if (Date.now() < pauseMaskPollingUntil.current || !activeStream) return;
    if (isDraggingMask) return;
    try {
      const res = await authFetch(`${API_BASE}/api/masks/${activeStream.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setMasks(prev => mergeMasks(data, prev));
    } catch { }
  }

  // Fetch masks when mask editor is shown, and poll every 5 seconds while open
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    if (showMaskEditor && Date.now() > pauseMaskPollingUntil.current) {
      interval = setInterval(() => { if (!cancelled) { fetchMasks() } }, 5000);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [showMaskEditor, pauseMaskPollingUntil, activeStream]);

  useEffect(() => {
    if (onSessionMonitorClosed) {
      // Listen for when session monitor closes on mobile
      const handleSessionMonitorClose = () => {
        if (isMobileWidth) {
          setShowMobileLogout(true);
          // Hide after 5 seconds
          setTimeout(() => {
            setShowMobileLogout(false);
          }, 5000);
        }
      };

      // Store the handler globally so it can be called from App.tsx
      (window as any).handleSessionMonitorClose = handleSessionMonitorClose;
    }

    return () => {
      delete (window as any).handleSessionMonitorClose;
    };
  }, [onSessionMonitorClosed, isMobileWidth]);

  // Update video size when video element is ready or resized
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function updateVideoSize(event: Event | null) {
      if (!video) return;
      // Only update if video has actual dimensions
      if (['canplay', undefined].includes(event?.type) && video.clientWidth > 0 && video.clientHeight > 0) {
        setTimeout(() => {
          setVideoSize({
            width: video.clientWidth,
            height: video.clientHeight,
          });
          setLastVideoSize({
            width: video.clientWidth,
            height: video.clientHeight,
          });

          // Clear fixed dimensions once video has loaded properly to allow responsive behavior
          video.style.width = '100%';
          video.style.height = '';

          // setIsLoadingStream(false); // Clear loading state when video has dimensions
        }, 200); // Delay to ensure video is ready
      }
    }

    // Initial update
    updateVideoSize(null);

    // Listen for loadedmetadata (in case video size changes after source set)
    video.addEventListener('loadedmetadata', updateVideoSize);
    video.addEventListener('loadeddata', updateVideoSize);
    video.addEventListener('canplay', updateVideoSize);

    // Use ResizeObserver for all resizes
    let resizeObserver: ResizeObserver | null = null;
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        updateVideoSize(null);
      });
      resizeObserver.observe(video);
    }

    // Clean up
    return () => {
      video.removeEventListener('loadedmetadata', updateVideoSize);
      video.removeEventListener('loadeddata', updateVideoSize);
      video.removeEventListener('canplay', updateVideoSize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [videoRef, activeStream]);

  // Add this effect to set video size on mount using lastVideoSize
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (lastVideoSize.width > 0 && lastVideoSize.height > 0) {
      video.style.width = '100%';
      video.style.height = `${lastVideoSize.height}px`;
    }
  }, [videoRef]);

  // Optimistic mask move handler
  const handleMaskMove = (maskId: string, newPos: { x: number; y: number; w: number; h: number }) => {
    setMasks(prevMasks =>
      prevMasks.map(maskObj => {
        if (maskObj.id !== maskId) return maskObj;
        let mask;
        try {
          mask = typeof maskObj.mask === 'string' ? JSON.parse(maskObj.mask) : maskObj.mask;
        } catch {
          return maskObj;
        }
        // Always update all four properties
        const updatedMask = {
          ...mask,
          x: newPos.x,
          y: newPos.y,
          w: newPos.w,
          h: newPos.h,
          type: maskObj.type,
          pendingUpdate: true,
          pendingUpdateSince: Date.now(),
        };
        return { ...maskObj, mask: JSON.stringify(updatedMask) };
      })
    );
  };

  const masksRef = useRef(masks);
  useEffect(() => { masksRef.current = masks; }, [masks]);

  function openAndScrollToRecordingsList() {
    if (!recordingsListOpen) setRecordingsListOpen(true);
    setTimeout(() => {
      const list = recordingsListRef.current;
      if (list) {
        const rect = list.getBoundingClientRect();
        const scrollY = window.scrollY || window.pageYOffset;
        const targetY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      }
    }, recordingsListOpen ? 0 : 400); // Wait for open animation if needed
  }

  // --- Fetch streams from backend ---
  useEffect(() => {
    async function fetchStreams() {
      setStreamsLoading(true);
      setStreamError(null);
      try {
        const res = await authFetch(`${API_BASE}/api/streams`);
        if (!res.ok) throw new Error('Failed to fetch streams');
        const data = await res.json();
        setStreams(data || []);
        // Set active stream if not set
        if (!activeStream && (data?.length > 0)) {
          const getActiveStream = () => {
            const storedStreamId = localStorage.getItem('activeStreamId');
            const id =
              (location.state && (location.state as any).streamId) ||
              streamId ||
              params.streamId ||
              storedStreamId;
            return data.find((s: Stream) => s.id === id) || data[0];
          }
          setActiveStream(getActiveStream());
        }
      } catch (err: any) {
        setStreamError(err.message || 'Failed to load streams');
      } finally {
        setStreamsLoading(false);
      }
    }
    fetchStreams();
  }, []);

  // --- Update activeStream if streams change or streamId param changes ---
  useEffect(() => {
    if (!streams.length) return;
    if (activeStream && streams.find(s => s.id === activeStream.id)) return;

    const getActiveStream = () => {
      const storedStreamId = localStorage.getItem('activeStreamId');
      const id =
        (location.state && (location.state as any).streamId) ||
        streamId ||
        params.streamId ||
        storedStreamId;
      return streams.find(s => s.id === id) || streams[0];
    }

    // If streamId param is present, select that
    if (streamId) {
      const found = streams.find(s => s.id === streamId);
      if (found) setActiveStream(found);
      else setActiveStream(getActiveStream());
    } else {
      setActiveStream(getActiveStream());
    }
  }, [streams, streamId]);

  // --- Helper: get signed thumb URL for a stream ---
  function getThumbUrl(stream: Stream) {
    // Use signedThumbUrls if available, fallback to /api/signed-latest-thumb-url/:id
    if (signedThumbUrls[stream.id]?.url) {
      // Throttle thumbnail requests to once per second using modulus
      const throttledTimestamp = Math.floor(Date.now() / 1000); // Only updates once per second
      return signedThumbUrls[stream.id].url + (signedThumbUrls[stream.id].url.includes('?') ? '&' : '?') + 't=' + throttledTimestamp;
    }
    return `${API_BASE}/api/signed-latest-thumb-url/${stream.id}`;
  }

  // --- Stream Tiles Grid ---
  const maxStreams = 4;
  const orderedStreams = getOrderedStreams(streams, streamOrder);
  const gridStreams = orderedStreams.slice(0, maxStreams);
  const canAddStream = streams.length < maxStreams;

  // --- Stream editing logic ---
  const handleOpenSettings = (stream: Stream) => {
    setEditingStream(stream);
    setShowSettingsModal(true);
  };
  const handleSaveSettings = async (stream: Stream, newNickname: string) => {
    if (newNickname.trim() && newNickname !== stream.nickname) {
      await authFetch(`${API_BASE}/api/streams/${stream.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: newNickname.trim() })
      });
      // Refresh streams
      const res = await authFetch(`${API_BASE}/api/streams`);
      const data = await res.json();
      setStreams(data || []);
    }
    setShowSettingsModal(false);
    setEditingStream(null);
  };

  return (
    <div className="App with-side-padding">
      {showDebug && <DebugInfo onClose={() => { setShowDebug(false); recordingsListRef.current?.focus() }} />}
      <ErrorModal
        open={errorModalOpen}
        message={errorModalMsg}
        onClose={() => setErrorModalOpen(false)}
      />
      <div style={{ userSelect: 'none' }}>
        {/* Main video and mask editor remain unchanged, but use activeStream */}
        <div
          className='main-video-container'
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            maxWidth: 900,
            margin: `25px auto`
          }}
        >
          <RecordingBar
            open={!!recordingBeingViewed}
            streamId={recordingBeingViewed?.streamId ?? ''}
            filename={recordingBeingViewed?.filename ?? ''}
            onClose={() => setRecordingBeingViewed(null)}
            cachedRecordings={recordingBeingViewed ? cachedRecordings[recordingBeingViewed.streamId] ?? [] : []}
            onNavigate={filename => {
              if (!activeStream) return;
              setOpeningRecording(true);
              setRecordingBeingViewed(
                recordingBeingViewed ? { streamId: recordingBeingViewed.streamId, filename } : null
              )
              setOpeningRecording(false);
              const recordingsStream = viewingRecordingsFrom ?? activeStream;
              if (!viewed.find(viewed => viewed.filename === filename && viewed.streamId === recordingsStream.id)) {
                const updated = [...viewed, { filename, streamId: recordingsStream.id }];
                setViewed(updated);
              }
            }}
            setAutoScrollUntilRef={until => { autoScrollUntilRef.current = until; }}
            setNicknames={setNicknames}
            setOpeningRecording={setOpeningRecording}
          />
          <div className="stream-video-container" style={{ position: 'relative' }}>
            <StreamControls
              shouldNotifyOnMotion={shouldNotifyOnMotion}
              setIsLoadingMotionNotifications={setIsLoadingMotionNotifications}
              isLoadingMotionNotifications={isLoadingMotionNotifications}
              setShouldNotifyOnMotion={setShouldNotifyOnMotion}
              showMaskEditor={showMaskEditor}
              setShowMaskEditor={setShowMaskEditor}
              onShowSessionMonitor={onShowSessionMonitor}
              showMobileLogout={showMobileLogout}
              isMobile={isMobileWidth}
              handleLogout={handleLogout}
              activeStream={activeStream}
              setMasks={setMasks}
              authFetch={authFetch}
              API_BASE={API_BASE}
              pauseMaskPollingUntil={pauseMaskPollingUntil}
            />

            {/* Main stream element with loading state and StreamControlBar */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <video
                ref={videoRef}
                autoPlay
                muted
                style={
                  isLoadingStream
                    ? {
                      minWidth: 'auto',
                      minHeight: 'auto',
                      width: `${Math.max(lastVideoSize.width, 320)}px`,
                      height: `${Math.max(lastVideoSize.height, 180)}px`,
                      background: '#000',
                      transition: 'none',
                      display: 'block',
                    }
                    : {
                      width: '100%',
                      height: 'auto',
                      background: '#000',
                      transition: 'all 0.2s ease-out',
                      display: 'block',
                    }
                }
              />

              {/* Optional: Add a loading overlay */}
              {isLoadingStream && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: '1.1em',
                    fontWeight: 600,
                    pointerEvents: 'none',
                    zIndex: 1
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        border: '3px solid rgba(255, 255, 255, 0.3)',
                        borderTop: '3px solid #fff',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }}
                    />
                    Loading stream...
                  </div>
                </div>
              )}

              {/* Position StreamControlBar as overlay directly on video */}
              <StreamControlBar
                videoRef={videoRef}
                activeStream={activeStream}
              />
            </div>
            {showMaskEditor && (
              <MaskEditorOverlay
                pauseMaskPollingUntil={pauseMaskPollingUntil}
                masks={masks}
                setMasks={setMasks}
                streamWidth={videoSize.width}
                streamHeight={videoSize.height}
                maskBaseWidth={160}
                maskBaseHeight={90}
                setIsDraggingMask={setIsDraggingMask}
                onMaskMove={handleMaskMove}
                saveMaskPosition={async (maskId, newPos) => {
                  const maskObj = masksRef.current.find(m => m.id === maskId);
                  if (!maskObj) {
                    console.warn(`Mask with ID ${maskId} not found`);
                    return;
                  }
                  if (!activeStream) return console.warn('No active stream to save mask position');
                  let mask;
                  try {
                    mask = typeof maskObj.mask === 'string' ? JSON.parse(maskObj.mask) : maskObj.mask;
                  } catch {
                    console.warn(`Failed to parse mask for ID ${maskId}`);
                    return;
                  }

                  // Always use all four properties from newPos, fallback to mask if missing
                  const x = newPos.x ?? mask.x;
                  const y = newPos.y ?? mask.y;
                  const w = newPos.w ?? mask.w;
                  const h = newPos.h ?? mask.h;

                  const updatedMask = { ...mask, x, y, w, h, type: maskObj.type };
                  setMasks(prevMasks =>
                    prevMasks.map(maskObj => {
                      if (maskObj.id !== maskId) return maskObj;
                      return {
                        ...maskObj,
                        mask: JSON.stringify(updatedMask),
                        pendingUpdate: true,
                        pendingUpdateSince: Date.now(),
                      };
                    })
                  );
                  // After any mask API update:
                  pauseMaskPollingUntil.current = Date.now() + 1000; // Pause polling for 1 second
                  await authFetch(`${API_BASE}/api/masks/${activeStream.id}/${maskId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mask: updatedMask }),
                  });
                  // After your authFetch PATCH/POST/DELETE completes:
                  setMasks(prevMasks =>
                    prevMasks.map(maskObj => {
                      if (maskObj.id !== maskId) return maskObj;
                      const since = maskObj.pendingUpdateSince ?? Date.now();
                      const elapsed = Date.now() - since;
                      if (elapsed < 600) {
                        setTimeout(() => {
                          setMasks(masksNow =>
                            masksNow.map(m =>
                              m.id === maskId ? { ...m, pendingUpdate: false, pendingUpdateSince: undefined } : m
                            )
                          );
                        }, 600 - elapsed);
                        return { ...maskObj }; // keep pendingUpdate true for now
                      }
                      return { ...maskObj, pendingUpdate: false, pendingUpdateSince: undefined };
                    })
                  );
                }}
              />
            )}
          </div>
          {/* Optionally, add your mask editor modal here */}
          {/* {showMaskEditor && <MaskEditorModal onClose={() => setShowMaskEditor(false)} ... />} */}
        </div>
        {/* --- End Main Video and Mask Editor --- */}
        {/* Stream Tiles Grid */}
        <StreamTilesGrid
          streams={gridStreams}
          canAddStream={canAddStream}
          setActiveStream={setActiveStream}
          onAddStream={() => setShowAddStreamModal(true)}
          onOpenSettings={handleOpenSettings}
          onDeleteStream={async (stream) => {
            try {
              const res = await authFetch(`${API_BASE}/api/streams/${stream.id}`, {
                method: 'DELETE'
              });

              if (!res.ok) {
                const error = await res.json().catch(() => ({}));
                alert(`Failed to delete stream: ${error.message || 'Unknown error'}`);
                return;
              }

              // Remove the stream from the list
              setStreams(prevStreams => prevStreams.filter(s => s.id !== stream.id));

              // If this was the active stream, switch to another one
              if (activeStream?.id === stream.id) {
                const remainingStreams = streams.filter(s => s.id !== stream.id);
                if (remainingStreams.length > 0) {
                  setActiveStream(remainingStreams[0]);
                } else {
                  setActiveStream(null);
                }
              }

              // Clean up any cached data for this stream
              setCachedRecordings(prev => {
                const updated = { ...prev };
                delete updated[stream.id];
                return updated;
              });

              setLastSeenRecording(prev => {
                const updated = { ...prev };
                delete updated[stream.id];
                return updated;
              });

              setDeletedRecordings(prev => {
                const updated = { ...prev };
                delete updated[stream.id];
                return updated;
              });

              setTotalRecordings(prev => {
                const updated = { ...prev };
                delete updated[stream.id];
                return updated;
              });

            } catch (err: any) {
              console.error('Failed to delete stream:', err);
              alert(`Failed to delete stream: ${err.message || 'Network error'}`);
            }
          }}
          getThumbUrl={getThumbUrl}
          onViewRecordings={setViewingRecordingsFrom}
          onToggleMotionPause={async (stream, motionRecordingEnabled) => {
            const response = await authFetch(`${API_BASE}/api/motion-pause/${stream.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paused: !motionRecordingEnabled }),
            });
            const { paused } = await response.json();
            setMotionRecordingPaused(prev => ({
              ...prev,
              [stream.id]: paused,
            }));
          }}
          motionRecordingPaused={isMotionRecordingPaused}
          motionStatus={motionStatus}
          activeStreamId={activeStream?.id}
          motionSaving={Object.entries(motionStatus).reduce((prev, e) => ({ ...prev, [e[0]]: e[1].saving }), {})}
        />

        {/* Desktop: Show heading and search tools */}
        <div className="desktop-only" style={{ alignItems: 'center', width: '100%' }}>
          <h3 style={{ margin: 0, marginRight: 16, color: '#fff', fontFamily: "'Orbitron', 'Roboto', Arial, sans-serif", userSelect: 'none', }}>
            Motion Recordings
          </h3>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <div ref={searchStickySentinelRef} style={{ height: 1 }} />
          </div>
        </div>

        {/* Mobile: Sentinel for sticky behavior */}
        <div className="mobile-only">
          <div ref={mobileSearchStickySentinelRef} style={{ height: 1 }} />
        </div>

        {/* Unified Search Tools with conditional desktop alignment wrapper */}
        <div style={isMobileWidth ? {} : { display: 'flex', justifyContent: 'flex-end' }}>
          <div
            className={
              isMobileWidth
                ? `searchtools-sticky${mobileSearchSticky || forceSticky ? ' active' : ''}${forceSticky ? ' force-sticky' : ''}`
                : `searchtools-sticky${searchSticky ? ' active' : ''}`
            }
            ref={searchStickyRef}
          >
            <SearchTools
              ref={searchToolsRef}
              autoScrollUntilRef={autoScrollUntilRef}
              dateRange={dateRange}
              setDateRange={setDateRange}
              search={search}
              setSearch={setSearch}
              filterOpen={filterOpen}
              setFilterOpen={setFilterOpen}
              isNicknamedOnly={isNicknamedOnly}
              setIsNicknamedOnly={setIsNicknamedOnly}
              refreshing={isMobileWidth ? undefined : isDesktopRefreshing}
              isSearching={isSearching}
              openAndScrollToRecordingsList={openAndScrollToRecordingsList}
              onUserTyping={setUserTyping}
              onSearchInputActiveChange={setSearchInputActive}
              onFilterUpdateBlocked={setFilterUpdatesBlocked}
              onFocusSearchInput={isMobileWidth ? () => setForceSticky(true) : undefined}
              onBlurSearchInput={isMobileWidth ? () => setForceSticky(false) : undefined}
              onFocusSearchTools={() => setSearchToolsInteracting(true)}
              onBlurSearchTools={() => setSearchToolsInteracting(false)}
              onRefresh={isMobileWidth ? undefined : async () => {
                setIsDesktopRefreshing(true);
                const recordingsStream = viewingRecordingsFrom ?? activeStream;
                const start = Date.now();
                if (recordingsStream) await pollLatestRecordings(recordingsStream);
                else alert('No active stream to refresh recordings for');
                const elapsed = Date.now() - start;
                setTimeout(() => setIsDesktopRefreshing(false), Math.max(0, 600 - elapsed));
              }}
            />
          </div>
        </div>
      </div>
      {/* Motion Recordings label for mobile */}
      <div className='mobile-only'>
        <div
          className="motion-recordings-mobile-label"
          style={{
            width: '100%',
            textAlign: 'center',
            margin: '16px 0 0 0',
            fontFamily: "'Orbitron', 'Roboto', Arial, sans-serif",
            fontSize: '1.3em',
            color: '#fff',
            letterSpacing: 1.5,
            zIndex: 1,
            position: 'relative',
            transition: 'opacity 0.5s cubic-bezier(.4,2,.6,1)',
            opacity: 1,
            pointerEvents: 'none'
          }}
        >
          Motion Recordings
        </div>
      </div>

      {/* Recordings List */}
      <div
        className='recordings-list'
        ref={recordingsListRef}
        tabIndex={-1}
        onScroll={() => {
          setIsRecordingsListScrolling(true);
          // Debounce: set back to false after scrolling stops for 120ms
          if ((window as any)._scrollTimeout) clearTimeout((window as any)._scrollTimeout);
          (window as any)._scrollTimeout = setTimeout(() => setIsRecordingsListScrolling(false), 120);
        }}
        style={{
          overscrollBehavior: isTouchInput ? 'none' : 'auto',
          maxHeight: '60vh',
          height: recordingsListOpen ? '60vh' : '48px',
          transition: 'height 0.7s cubic-bezier(.4,2,.6,1)',
          boxShadow: '0 2px 16px #1a2980, 0 1px 0 #fff1',
          background: 'rgba(20,30,60,0.97)',
          borderRadius: '18px 18px 0 0',
          overflowY: transferScrollToPage ? 'hidden' : (recordingsListOpen ? 'auto' : 'hidden'), // <-- updated
          touchAction: transferScrollToPage ? 'none' : undefined, // <-- updated
          pointerEvents: recordingsListOpen ? 'auto' : 'all',
        }}
      >
        <RecordingsListContent
          recordingsListOpen={recordingsListOpen}
          pullDistance={pullDistance}
          pullThreshold={pullThreshold}
          pullStartY={pullStartY}
          gridOuterRef={gridOuterRef}
          isMobile={isMobileWidth}
          filteredRecordings={filteredRecordings}
          search={search}
          isNicknamedOnly={isNicknamedOnly}
          dateRange={dateRange}
          isSearching={isSearching}
          userTyping={userTyping}
          activeStream={activeStream}
          selected={selected}
          viewingRecordingsFrom={viewingRecordingsFrom}
          hovered={hovered}
          setHovered={setHovered}
          recordingsListRef={recordingsListRef}
          handleTouchStart={handleTouchStart}
          handleTouchEnd={handleTouchEnd}
          handleView={handleView}
          handleCheckboxChange={handleCheckboxChange}
          nicknames={nicknames}
          viewed={viewed}
          totalRecordings={totalRecordings}
          cachedRecordings={cachedRecordings}
          isLoadingMore={isLoadingMore}
          setIsLoadingMore={setIsLoadingMore}
          setCurrentPage={setCurrentPage}
          loadPage={loadPage}
          currentPage={currentPage}
          mobileSearchSticky={mobileSearchSticky}
          setRecordingsListOpen={setRecordingsListOpen}
          setTransferScrollToPage={setTransferScrollToPage}
          lastRecordingsListCloseTime={lastRecordingsListCloseTime}
          openingRecording={openingRecording}
          videoRef={videoRef}
          onRequestClose={() => {
            setRecordingsListOpen(false);
            setTransferScrollToPage(false);
            lastRecordingsListCloseTime.current = Date.now();
            setTimeout(() => window.scrollTo({ behavior: 'smooth', top: 0 }), 450);
          }}
          setPullDistance={setPullDistance}
          transferScrollToPage={transferScrollToPage}
        />
        <div ref={recordingsListBottomSentinelRef} style={{ height: 1 }} />
      </div>
      {/* Overlay to block touch scrolls and open debug logs below the recordings list on touch devices */}
      {isTouchInput && recordingsListOpen && isAtBottomOfPage && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            top: `80vh`, // Adjust if needed to match the bottom of the recordings list
            bottom: 0,
            zIndex: 1000,
            background: 'transparent',
            opacity: recordingsListOpen ? 1 : 0,
            touchAction: 'none',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
          onTouchStart={e => {
            if (selected.length === 0 && isAtBottomOfPage) {
              e.preventDefault();
              handleCopyrightTouchStart();
            }
          }}
          onTouchMove={e => e.preventDefault()}
          onTouchEnd={() => {
            if (selected.length === 0) {
              handleCopyrightTouchEnd();
            }
          }}
        />
      )}
      <div style={{ height: recordingsListOpen ? 80 : 0 }} />
      <div
        style={{
          width: '100%',
          textAlign: 'center',
          color: '#bcd',
          fontSize: '0.98em',
          marginTop: 16,
          marginBottom: 24,
          opacity: 0.7,
          letterSpacing: 1,
          userSelect: 'none'
        }}
      >
        gander © {new Date().getFullYear()} Brandon Bothell. All rights reserved.
      </div>
      <div
        style={{
          height: isAndroid() && searchInputActive ? '50vh' : '20vh', // Extra space on Android when search is active
          width: '100%',
        }}
      />

      {/* Floating handle: only show if floating, not open */}
      {(!recordingsListOpen || !recordingsListInView) && (
        <div
          className="recordings-list-handle-floating"
          tabIndex={0}
          onClick={() => {
            setRecordingsListOpen(true);
            setTimeout(() => {
              const list = recordingsListRef.current;
              if (list) {
                const rect = list.getBoundingClientRect();
                const scrollY = window.scrollY || window.pageYOffset;
                const targetY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
                window.scrollTo({ top: targetY, behavior: 'smooth' });
              }
            }, 400);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              setRecordingsListOpen(true);
              setTimeout(() => {
                const list = recordingsListRef.current;
                if (list) {
                  const rect = list.getBoundingClientRect();
                  const scrollY = window.scrollY || window.pageYOffset;
                  const targetY = rect.top + scrollY - (window.innerHeight / 2) + (rect.height / 2);
                  window.scrollTo({ top: targetY, behavior: 'smooth' });
                }
              }, 400);
            }
          }}
          aria-label="Open recordings list"
          style={{
            position: 'fixed',
            right: '-2.5%',
            bottom: isMobileWidth ? 40 : 10,
            transform: 'translateX(-50%)',
            zIndex: 2002,
            width: 80,
            height: 80,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            cursor: 'pointer',
            outline: 'none',
            borderRadius: 24,
            pointerEvents: 'auto',
          }}
        >
          <FiChevronDown
            size={60}
            color="#1cf1d1"
            style={{
              marginBottom: 0,
              filter: 'drop-shadow(0 2px 8px #1cf1d1cc)',
              animation: 'bounceDown 5s infinite cubic-bezier(.4,2,.6,1), pulseDropShadow 5s infinite cubic-bezier(.4,2,.6,1)',
            }}
          />
          <div
            className="recordings-list-handle"
            style={{
              width: 56,
              height: 12,
              borderRadius: 6,
              background: 'linear-gradient(90deg, #1cf1d1 60%, #2196f3 100%)',
              margin: '12px 0 0 0',
              cursor: 'pointer',
              transition: 'background 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 12px #1cf1d1aa',
            }}
          />
          {/* Add keyframes for pulse and bounce */}
          <style>
            {`
              @keyframes bounceDown {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(12px); }
              }
              @keyframes pulseDropShadow {
              0% { filter: drop-shadow(0 2px 8px #1cf1d1cc); }
              50% { filter: drop-shadow(0 8px 32px #1cf1d1ff); }
              100% { filter: drop-shadow(0 2px 8px #1cf1d1cc); }
              }
            `}
          </style>
        </div>
      )}

      {/* Floating menu button and popout for batch recording edits */}
      {selected.length > 0 && <FloatingMenuButton open={menuOpen} onClick={() => setMenuOpen(v => !v)} />}
      {activeStream && (<FloatingMenuPopout
        selected={selected}
        setSelected={setSelected}
        viewingStreamId={viewingRecordingsFrom?.id ?? activeStream.id}
        cachedRecordings={cachedRecordings[viewingRecordingsFrom?.id ?? activeStream.id]}
        setRecordings={recs => {
          if (!activeStream) return;

          const viewingStream = viewingRecordingsFrom ?? activeStream;

          setCachedRecordings(prev => ({
            ...prev,
            [viewingStream.id]: recs.sort((a, b) => b.filename.localeCompare(a.filename))
          }));
          setTotalRecordings(prev => ({
            ...prev,
            [viewingStream.id]: Math.max(0, (prev[viewingStream.id] || 0) - selected.length)
          }));
          handleImmediateDeleteUpdate(selected);
          setMenuOpen(false); // <-- Close menu on batch delete
        }}
        recordingsListRef={recordingsListRef}
        open={menuOpen}
      />)}

      {/* Modals */}
      <AddStreamModal
        showModal={showAddStreamModal}
        onClose={() => setShowAddStreamModal(false)}
        onStreamCreated={(newStreamData) => {
          setStreams(streams => streams ? [...streams, newStreamData as Stream] : [newStreamData as Stream]);
        }}
        authFetch={authFetch}
        API_BASE={API_BASE}
      />
      <StreamSettingsModal
        showModal={showSettingsModal}
        stream={editingStream}
        onClose={() => {
          setShowSettingsModal(false);
          setEditingStream(null);
        }}
        onSave={async (stream, newNickname) => {
          await handleSaveSettings(stream, newNickname);
        }}
        onReconnect={async (stream) => {
          if (!stream) return;
          setIsLoadingStream(true);
          try {
            await authFetch(`${API_BASE}/api/streams/${stream.id}/reconnect`, { method: 'POST' });
            setTimeout(loadStream, 5000); // Reload video element
          } catch (err: any) {
            console.error('Failed to reconnect stream:', err);
            alert(`Failed to reconnect stream: ${err.message || 'Network error'}`);
          } finally {
            setTimeout(() => setIsLoadingStream(false), 5000);
          }
        }}
      />
    </div>
  );
}

function seekToLiveEdgeGentle(videoRef: React.RefObject<HTMLVideoElement | null>, hls?: any) {
  const video = videoRef.current;
  if (!video || video.paused) return;

  if (hls && hls.liveSyncPosition !== undefined) {
    // Be more conservative for initial seek - stay further from live edge
    const targetTime = hls.liveSyncPosition - 3; // 3 seconds behind live edge
    console.log(`Initial gentle seek to HLS live edge: ${targetTime.toFixed(2)}s`);
    video.currentTime = Math.max(0, targetTime);
  } else if (video.duration && Number.isFinite(video.duration)) {
    // More conservative for initial load
    const targetTime = video.duration - 2;
    console.log(`Initial gentle seek to duration-based live edge: ${targetTime.toFixed(2)}s`);
    video.currentTime = Math.max(0, targetTime);
  } else if (video.seekable && video.seekable.length > 0) {
    const targetTime = video.seekable.end(video.seekable.length - 1) - 2;
    console.log(`Initial gentle seek to seekable live edge: ${targetTime.toFixed(2)}s`);
    video.currentTime = Math.max(0, targetTime);
  }
}

// Enhanced live seeking function
function seekToLiveEdge(videoRef: React.RefObject<HTMLVideoElement | null>, hls?: any) {
  const video = videoRef.current;
  if (!video || video.paused) return;

  if (hls && hls.liveSyncPosition !== undefined) {
    // Use HLS.js live sync position for most accurate live edge
    const targetTime = hls.liveSyncPosition - 1; // 1 second behind live edge for stability
    console.log(`Seeking to HLS live edge: ${targetTime.toFixed(2)}s`);
    video.currentTime = Math.max(0, targetTime);
  } else if (video.duration && Number.isFinite(video.duration) && video.duration > 0) {
    // Fallback to duration-based seeking
    const targetTime = video.duration - 0.5; // Very close to live
    console.log(`Seeking to duration-based live edge: ${targetTime.toFixed(2)}s`);
    video.currentTime = Math.max(0, targetTime);
  } else if (video.seekable && video.seekable.length > 0) {
    // Use seekable range if available
    const targetTime = video.seekable.end(video.seekable.length - 1) - 0.5;
    console.log(`Seeking to seekable live edge: ${targetTime.toFixed(2)}s`);
    video.currentTime = Math.max(0, targetTime);
  }
}

// Update the existing seekToLive function
function seekToLive(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const video = videoRef.current;
  if (!video || video.paused) return;

  // Get HLS instance if available
  const hls = (video as any)._hls;

  if (hls) {
    seekToLiveEdge(videoRef, hls);
  } else {
    // Fallback for non-HLS streams
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = video.duration - 1;
    } else if (video.seekable && video.seekable.length > 0) {
      video.currentTime = video.seekable.end(video.seekable.length - 1) - 1;
    }
  }
}

function getLocalDateString(date: Date = new Date()) {
  // Returns YYYY-MM-DD in the user's local time
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mergeMasks(serverMasks: StreamMask[], clientMasks: ClientMask[]): ClientMask[] {
  const pending = clientMasks.filter(m => m.pendingUpdate);
  const merged = serverMasks.map(serverMask => {
    const pendingMask = pending.find(m => m.id === serverMask.id);
    return pendingMask ? pendingMask : serverMask;
  });
  // Add any pending masks not present in serverMasks (e.g., just created)
  pending.forEach(pm => {
    if (!merged.find(m => m.id === pm.id)) merged.push(pm);
  });
  return merged;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && 'ontouchend' in document);
}

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
};

// Add this function near the other helper functions in StreamPage.tsx
function playNotificationTone() {
  // Fallback: Create a brief notification tone using Web Audio API
  // This is less likely to interrupt other audio
  try {
    const AudioContext = window.AudioContext ?? (window as any).webkitAudioContext;
    const audioContext = new AudioContext();

    // Create a brief, subtle notification tone
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Configure the tone
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // 800Hz tone
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01); // Fade in
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.15); // Fade out

    // Play for 150ms
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.15);

    // Clean up
    setTimeout(() => {
      try {
        audioContext.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    }, 200);

  } catch (error) {
    console.log('Web Audio API notification tone failed:', error);
  }
}
