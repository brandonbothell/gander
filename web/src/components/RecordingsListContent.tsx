import { FiRefreshCw, FiChevronUp } from "react-icons/fi";
import { isIOS } from "../StreamPage";
import { RecordingThumbItem } from "./RecordingThumbItem";

interface RecordingsListContentProps {
  recordingsListOpen: boolean;
  refreshIconState: string;
  pullDistance: number;
  pullThreshold: number;
  pullStartY: React.RefObject<number | null>;
  isMobileRefreshing: boolean;
  isMobile: boolean;
  filteredRecordings: Array<any>;
  search: string;
  isNicknamedOnly: boolean;
  dateRange: { from?: string | null; to?: string | null };
  isSearching: boolean;
  userTyping: boolean;
  activeStream: any;
  selected: string[];
  viewingRecordingsFrom: any;
  hovered: string | null;
  setHovered: (filename: string | null) => void;
  recordingsListRef: React.RefObject<HTMLDivElement | null>;
  handleTouchStart: (filename: string, checked: boolean) => void;
  handleTouchEnd: () => void;
  handleView: (filename: string) => void;
  handleCheckboxChange: (filename: string, checked: boolean) => void;
  nicknames: Record<string, string>;
  viewed: Array<{ filename: string; streamId: string }>;
  totalRecordings: Record<string, number>;
  cachedRecordings: Record<string, Array<any>>;
  isLoadingMore: boolean;
  setIsLoadingMore: (loading: boolean) => void;
  setCurrentPage: (page: number) => void;
  setFilteredRecordingsPage: (fn: (page: number) => number) => void;
  loadPage: (stream: any, page: number, append: boolean) => Promise<void>;
  currentPage: number;
  mobileSearchSticky: boolean;
  setRecordingsListOpen: (open: boolean) => void;
  setTransferScrollToPage: (value: boolean) => void;
  lastRecordingsListCloseTime: React.RefObject<number>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export default function RecordingsListContent(props: RecordingsListContentProps) {
  const {
    recordingsListOpen,
    refreshIconState,
    pullDistance,
    pullThreshold,
    pullStartY,
    isMobileRefreshing,
    isMobile,
    filteredRecordings,
    search,
    isNicknamedOnly,
    dateRange,
    isSearching,
    userTyping,
    activeStream,
    selected,
    viewingRecordingsFrom,
    hovered,
    setHovered,
    recordingsListRef,
    handleTouchStart,
    handleTouchEnd,
    handleView,
    handleCheckboxChange,
    nicknames,
    viewed,
    totalRecordings,
    cachedRecordings,
    isLoadingMore,
    setIsLoadingMore,
    setCurrentPage,
    setFilteredRecordingsPage,
    loadPage,
    currentPage,
    mobileSearchSticky,
    setRecordingsListOpen,
    setTransferScrollToPage,
    lastRecordingsListCloseTime,
    videoRef,
  } = props;
  // Component logic goes here
  return <>
    {recordingsListOpen && (<>
      {/* Animated refresh icon */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: 48,
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            // Animation logic:
            transform:
              refreshIconState === 'spinning'
                ? `translateX(-50%) translateY(130px)`
                : refreshIconState === 'snap'
                  ? `translateX(-50%) translateY(130px)`
                  : refreshIconState === 'hide'
                    ? `translateX(-50%) translateY(0px)`
                    : `translateX(-50%) translateY(${pullDistance < pullThreshold ? 0 : Math.min(pullDistance * 0.2, 120)}px)`,
            opacity:
              refreshIconState === 'hide'
                ? 0
                : pullStartY.current !== null && pullDistance > 0
                  ? 1
                  : isMobileRefreshing || refreshIconState === 'spinning'
                    ? 1
                    : 0,
            transition:
              refreshIconState === 'snap'
                ? 'transform 0.18s cubic-bezier(.4,2,.6,1)'
                : refreshIconState === 'hide'
                  ? 'transform 0.35s cubic-bezier(.4,2,.6,1), opacity 0.35s'
                  : 'transform 0.1s cubic-bezier(.4,2,.6,1), opacity 0.15s',
            fontSize: 32 + Math.min(pullDistance, 120) / 6,
            zIndex: 3,
          }}
        >
          <FiRefreshCw
            style={{
              transition: 'color 0.2s, filter 0.2s, font-size 0.2s',
              color: `rgb(28, 241, 209)`,
              fontSize: 32 + Math.min(pullDistance, 120) / 6,
              animation:
                isMobileRefreshing || refreshIconState === 'spinning'
                  ? 'spin 0.7s linear infinite'
                  : undefined,
            }}
          />
        </div>
      </div>
      {/* {isRefreshing && (
          <div className="refreshing-indicator">
            <span className="spinner" />
            Refreshing...
          </div>
        )} */}
      {/* Recordings List content update - with stable DOM during search */}
      {filteredRecordings.length === 0 ? (
        <em
          style={{
            display: 'block',
            paddingTop: isMobile ? 48 : 0,
            textAlign: 'center',
            color: '#999',
            fontSize: '1.1em',
            padding: '40px 20px',
          }}
        >
          {((search && search.length >= 2) || isNicknamedOnly || dateRange.from || dateRange.to)
            ? 'No recordings match your search criteria.'
            : 'No recordings yet.'}
        </em>
      ) : (
        <>
          {/* Always render the search animation container, but only show it when needed */}
          <div
            style={{
              display: isSearching || userTyping ? 'flex' : 'none',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 20px',
              color: '#1cf1d1',
              fontSize: '1.1em',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(20,30,60,0.9)',
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                border: '4px solid rgba(28, 241, 209, 0.3)',
                borderTop: '4px solid #1cf1d1',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: 16,
              }}
            />
            Searching recordings...
          </div>

          {/* Always render the recordings grid to maintain DOM stability */}
          <div
            className="recordings-grid"
            key={userTyping ? 'typing-mode' : 'normal-mode'} // Stable key during typing
            style={{
              // Add these styles to minimize layout shifts
              minHeight: filteredRecordings.length > 0 ? 'auto' : '200px',
              transition: userTyping ? 'none' : 'min-height 0.2s ease-out', // Disable transitions during typing
              position: 'relative',
              // Slightly dim the grid during search but keep it rendered
              opacity: isSearching ? 0.3 : 1,
              pointerEvents: isSearching ? 'none' : 'auto',
            }}
          >
            {activeStream && filteredRecordings.map(({ filename }) => {
              const checked = selected.includes(filename);
              const recordingsStream = viewingRecordingsFrom || activeStream;
              return (
                <RecordingThumbItem
                  recordingsListRef={recordingsListRef}
                  streamId={recordingsStream.id}
                  key={filename}
                  filename={filename}
                  checked={checked}
                  hovered={hovered === filename}
                  anySelected={selected.length > 0}
                  onMouseEnter={() => setHovered(filename)}
                  onMouseLeave={() => setHovered(null)}
                  onTouchStart={() => handleTouchStart(filename, checked)}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                  onClick={() => handleView(filename)}
                  onCheckboxChange={checked => handleCheckboxChange(filename, checked)}
                  nickname={nicknames[filename]}
                  viewed={viewed.find(v => v.filename === filename && v.streamId === recordingsStream.id) !== undefined}
                />
              );
            })}
          </div>
        </>
      )}
      {/* Load more button - only show for final 50 recordings */}
      {activeStream && (() => {
        const recordingsStream = viewingRecordingsFrom || activeStream;
        const totalRemaining = (totalRecordings[recordingsStream.id] || 0) - (cachedRecordings[recordingsStream.id]?.length || 0);
        const shouldShowButton = totalRemaining > 0 && totalRemaining <= 50;

        return shouldShowButton && (
          <button
            style={{
              margin: '24px auto 32px',
              display: 'block',
              padding: '10px 32px',
              fontSize: 16,
              borderRadius: 8,
              background: '#2196f3',
              color: '#fff',
              border: 'none',
              cursor: isLoadingMore ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              boxShadow: '0 2px 8px #1a298055',
              opacity: isLoadingMore ? 0.7 : 1
            }}
            disabled={isLoadingMore}
            onClick={async () => {
              setIsLoadingMore(true);
              const recordingsStream = viewingRecordingsFrom || activeStream;
              if (!recordingsStream) {
                alert('No active stream to load more recordings for');
                setIsLoadingMore(false);
                return;
              }
              const nextPage = currentPage + 1;
              setCurrentPage(nextPage);
              setFilteredRecordingsPage(page => page + 1);
              await loadPage(recordingsStream, nextPage, true);
              setIsLoadingMore(false);
            }}
          >
            {isLoadingMore ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" style={{
                  width: 18, height: 18, border: '3px solid #fff', borderTop: '3px solid #2196f3',
                  borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block'
                }} />
                Loading...
              </span>
            ) : (
              `Load final ${totalRemaining} recordings...`
            )}
          </button>
        );
      })()}

      {/* Handle */}
      {recordingsListOpen && (
        <div
          className="recordings-list-handle-parent"
          style={{
            position: 'sticky',
            bottom: 0,
            userSelect: 'none',
            zIndex: 2,
            height: 56,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginBottom: 12,
            cursor: 'pointer',
            background: 'none',
            border: '0 2px 8px #1a298044',
            // --- Add this for the cubic-bezier translate effect ---
            transform: mobileSearchSticky && isMobile
              ? `translateY(${isIOS() ? 0 : window.innerHeight * .02}px)`
              : 'translateY(0px)',
            transition: 'transform 0.5s cubic-bezier(.4,2,.6,1)',
          }}
          tabIndex={0}
          aria-label="Recordings list handle"
          onClick={() => {
            setRecordingsListOpen(false);
            setTransferScrollToPage(false);
            lastRecordingsListCloseTime.current = Date.now();
            setTimeout(() => {
              videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 450);
          }}
        >
          <FiChevronUp size={48} color="#1cf1d1" style={{ marginBottom: 0 }} />
          <div
            className="recordings-list-handle"
            style={{
              width: 48,
              height: 8,
              borderRadius: 4,
              background: 'rgb(28, 241, 209)',
              margin: '8px 0',
              cursor: 'pointer',
              transition: 'background 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 8px #1a298044',
            }}
          />
        </div>
      )}
    </>)}
  </>
}
