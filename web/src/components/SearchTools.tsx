import { forwardRef, useRef, useState, useEffect } from "react";
import { FiRefreshCw } from "react-icons/fi";
import { isIOS } from "../StreamPage";

interface SearchToolsProps {
  search: string;
  setSearch: (v: string) => void;
  filterOpen: boolean;
  setFilterOpen: (v: boolean) => void;
  isNicknamedOnly: boolean;
  setIsNicknamedOnly: (v: boolean) => void;
  dateRange: { from: string; to: string };
  setDateRange: React.Dispatch<React.SetStateAction<{
    from: string;
    to: string;
  }>>;
  refreshing?: boolean;
  onRefresh?: () => void;
  openAndScrollToRecordingsList?: () => void;
  onFocusSearchInput?: () => void;
  onBlurSearchInput?: () => void;
  autoScrollUntilRef: React.RefObject<number>;
  onUserTyping?: (typing: boolean) => void;
  onSearchInputActiveChange?: (active: boolean) => void;
  onFilterUpdateBlocked?: (blocked: boolean) => void;
  isSearching?: boolean; // Add this prop
}

export const SearchTools = forwardRef<HTMLDivElement, SearchToolsProps>(({
  search,
  setSearch,
  filterOpen,
  setFilterOpen,
  isNicknamedOnly,
  setIsNicknamedOnly,
  dateRange,
  setDateRange,
  refreshing,
  onRefresh,
  openAndScrollToRecordingsList,
  onBlurSearchInput,
  onUserTyping,
  onSearchInputActiveChange,
  onFilterUpdateBlocked,
  isSearching = false, // Add this prop with default value
}, ref) => {
  const [searchInputActive, setSearchInputActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  // Add state to track date input timeouts (keep this simple)
  const [dateInputTimeouts, setDateInputTimeouts] = useState<{ [key: string]: number }>({});

  // Add this state to SearchTools component:
  const [blockFilterUpdates, setBlockFilterUpdates] = useState<{ [key: string]: boolean }>({ from: false, to: false });

  // Clear timeouts when component unmounts
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      Object.values(dateInputTimeouts).forEach(timeoutId => {
        if (timeoutId) clearTimeout(timeoutId);
      });
    };
  }, [dateInputTimeouts]);

  // Notify parent when search input active state changes
  useEffect(() => {
    onSearchInputActiveChange?.(searchInputActive);
  }, [searchInputActive, onSearchInputActiveChange]);

  function focusInputWhenScrollSettled(input: HTMLInputElement | null) {
    if (!input) return;
    let lastScrollY = window.scrollY;
    let attempts = 0;
    function tryFocus() {
      if (attempts++ > 20) return; // Give up after ~2s
      if (Math.abs(window.scrollY - lastScrollY) < 2) {
        input!.focus();
      } else {
        lastScrollY = window.scrollY;
        setTimeout(tryFocus, 100);
      }
    }
    tryFocus();
  }

  // Focus the input when it becomes active
  useEffect(() => {
    if (searchInputActive && inputRef.current) {
      if (isIOS()) {
        focusInputWhenScrollSettled(inputRef.current);
      } else {
        inputRef.current.focus();
      }
    }
  }, [searchInputActive]);

  // Add this useEffect to notify parent when any field is blocked:
  useEffect(() => {
    const anyBlocked = Object.values(blockFilterUpdates).some(blocked => blocked);
    onFilterUpdateBlocked?.(anyBlocked);
  }, [blockFilterUpdates, onFilterUpdateBlocked]);

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const relatedTarget = e.relatedTarget as HTMLElement;

    // Don't blur if interacting with search controls
    if (relatedTarget?.closest('.searchtools-popout') ||
      relatedTarget?.closest('[data-search-control]')) {
      return;
    }

    // Use a timeout to allow other elements to be clicked without immediately closing
    blurTimeoutRef.current = window.setTimeout(() => {
      onBlurSearchInput?.();
      setSearchInputActive(false);
      onUserTyping?.(false);
    }, 150);
  };

  const handleInputFocus = () => {
    // Clear any pending blur timeout
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearch(newValue);

    // Clear any pending blur timeout when typing
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }

    // Indicate user is actively typing
    onUserTyping?.(true);

    // Clear the typing indicator after user stops typing for 2 seconds
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      onUserTyping?.(false);
    }, 800);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Unfocus the input when Enter is pressed
      if (inputRef.current) {
        inputRef.current.blur();
      }
      // This will trigger the blur handler which will deactivate the search input
    }
  };

  // Handle date input focus/click - start the simple 100ms timeout
  const handleDateInputFocus = (field: 'from' | 'to') => {
    // Clear any existing timeout for this field
    if (dateInputTimeouts[field]) {
      clearTimeout(dateInputTimeouts[field]);
    }

    // Block filter updates for this field during auto-population detection
    setBlockFilterUpdates(prev => ({ ...prev, [field]: true }));

    // Store the original value before iOS can change it
    const originalValue = dateRange[field];

    // Set a 100ms timeout to check if value changed
    const timeoutId = window.setTimeout(() => {
      // Get the actual DOM input value instead of relying on React state
      const input = document.querySelector(`input[data-date-field="${field}"]`) as HTMLInputElement;
      const currentInputValue = input?.value || '';

      // If the input value changed from what it was, reset it to empty
      if (currentInputValue !== originalValue && currentInputValue !== '') {
        // Reset the DOM input value
        if (input) {
          input.value = '';
        }
        // Reset the React state
        setDateRange(prev => ({ ...prev, [field]: '' }));
      }

      // Re-allow filter updates after the timeout
      setBlockFilterUpdates(prev => ({ ...prev, [field]: false }));
    }, 100); // Back to 100ms

    // Store the timeout ID
    setDateInputTimeouts(prev => ({ ...prev, [field]: timeoutId }));
  };

  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 0,
        width: "100%",
        maxWidth: 600,
        margin: "0 auto",
        position: "relative",
        paddingBottom: 8,
      }}
    >
      {/* Row: Refresh, Search - now properly centered */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          width: "100%",
        }}
      >
        {onRefresh && (
          <button
            onClick={onRefresh}
            aria-label="Refresh recordings"
            disabled={refreshing || isSearching}
            style={{
              background: "#1976d2",
              border: "none",
              borderRadius: 8,
              padding: "6px 16px",
              height: 36,
              fontSize: "1.1em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: (refreshing || isSearching) ? "not-allowed" : "pointer",
              boxShadow: "0 1px 4px #1a298055",
              opacity: (refreshing || isSearching) ? 0.7 : 1,
              pointerEvents: (refreshing || isSearching) ? "none" : "auto",
              boxSizing: "border-box",
              gap: 6,
              flexShrink: 0,
            }}
          >
            <FiRefreshCw
              size={22}
              color="#fff"
              style={{
                animation: refreshing ? "spin 0.7s linear infinite" : undefined,
                transition: "color 0.2s",
                display: "block",
              }}
            />
          </button>
        )}
        <div style={{
          position: "relative",
          width: "100%",
          maxWidth: 280,
          minWidth: 180,
          flex: "1 1 auto",
          height: "auto",
        }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search recordings..."
            value={search}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onFocus={handleInputFocus}
            onKeyDown={handleInputKeyDown}
            className="recording-nickname"
            disabled={isSearching}
            style={{
              fontSize: "16px",
              padding: "10px 16px",
              background: "#fff",
              color: "#232b4a",
              fontFamily: "'Roboto', Arial, sans-serif",
              outline: "none",
              border: "1.5px solid #1976d2",
              borderRadius: 8,
              boxShadow: "0 1px 4px #1a298055",
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              opacity: searchInputActive ? 1 : 0,
              pointerEvents: searchInputActive ? "auto" : "none",
              zIndex: searchInputActive ? 2 : 1,
              transition: "opacity 0.2s",
              boxSizing: "border-box",
              cursor: isSearching ? "not-allowed" : "text",
            }}
          />
          <div
            className="fake-search-input"
            style={{
              background: "#222",
              color: "#ccc",
              borderRadius: 8,
              padding: "10px 16px",
              fontSize: 16,
              cursor: isSearching ? "not-allowed" : "text",
              border: "1px solid #444",
              width: "100%",
              zIndex: 1,
              position: "relative",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              boxSizing: "border-box",
              opacity: searchInputActive ? 0 : (isSearching ? 0.5 : 1),
              transition: "opacity 0.2s",
            }}
            onClick={() => {
              if (!isSearching) {
                setSearchInputActive(true);
                setTimeout(() => {
                  inputRef.current?.focus();
                  openAndScrollToRecordingsList?.();
                }, 0);
              }
            }}
          >
            {search || "Search recordings..."}
          </div>
        </div>
      </div>

      {/* Spacer to prevent overlap when input is focused */}
      {searchInputActive && (
        <div style={{ height: 48, width: "100%" }} />
      )}

      {/* Row: Filter, Nicknamed checkbox, and Done buttons inline and centered */}
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button
          data-search-control="true"
          className="reload-btn"
          disabled={isSearching}
          style={{
            background: filterOpen ? "#1976d2" : "#1976d2",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "6px 16px",
            fontWeight: 700,
            fontSize: "1.1em",
            cursor: isSearching ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 1px 4px #1a298055",
            position: "relative",
            height: 36,
            opacity: isSearching ? 0.5 : 1,
            pointerEvents: isSearching ? "none" : "auto",
          }}
          onClick={() => {
            if (!isSearching) {
              setFilterOpen(!filterOpen);
              openAndScrollToRecordingsList?.();
            }
          }}
          aria-label="Filter"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="7" stroke="#fff" strokeWidth="2" />
            <path d="M10 6v2M10 12v2M6 10h2M12 10h2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Filter
        </button>

        <label
          data-search-control="true"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#fff",
            fontWeight: 500,
            fontSize: "1.1em",
            cursor: isSearching ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            opacity: isSearching ? 0.5 : 1,
            pointerEvents: isSearching ? "none" : "auto",
          }}
        >
          <input
            type="checkbox"
            checked={isNicknamedOnly}
            disabled={isSearching}
            onChange={e => {
              if (!isSearching) {
                setIsNicknamedOnly(e.target.checked);
              }
            }}
            style={{
              accentColor: "#1976d2",
              width: 18,
              height: 18,
              cursor: isSearching ? "not-allowed" : "pointer",
              opacity: isSearching ? 0.5 : 1,
            }}
          />
          Nicknamed
        </label>

        {searchInputActive && (
          <button
            type="button"
            disabled={isSearching}
            style={{
              background: "#1cf1d1",
              color: "#232b4a",
              border: "none",
              borderRadius: 8,
              padding: "6px 18px",
              fontWeight: 600,
              fontSize: 16,
              cursor: isSearching ? "not-allowed" : "pointer",
              boxShadow: "0 1px 4px #1a298055",
              height: 36,
              opacity: isSearching ? 0.5 : 1,
            }}
            onClick={() => {
              if (!isSearching) {
                setSearchInputActive(false);
                onBlurSearchInput?.();
                onUserTyping?.(false);
              }
            }}
          >
            Done
          </button>
        )}
      </div>

      {/* Filter options popout */}
      {filterOpen && (
        <div className="searchtools-popout">
          <div className="searchtools-popout-content">
            <label style={{ display: "flex", flexDirection: "column", gap: 4, color: "#fff", fontWeight: 500 }}>
              Date Range
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  data-date-field="from"
                  value={dateRange.from}
                  disabled={isSearching}
                  onFocus={() => {
                    if (!isSearching) {
                      handleDateInputFocus('from');
                    }
                  }}
                  onChange={e => {
                    // COMPLETELY block onChange during auto-population detection OR while searching
                    if (!blockFilterUpdates.from && !isSearching) {
                      const val = e.target.value;
                      setDateRange(prev => ({ ...prev, from: /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : "" }));
                    }
                  }}
                  style={{
                    borderRadius: 6,
                    border: "1px solid #1976d2",
                    padding: "2px 6px",
                    background: "#fff",
                    color: "#232b4a",
                    cursor: isSearching ? "not-allowed" : "auto",
                    opacity: isSearching ? 0.5 : 1,
                  }}
                />
                <span style={{ color: "#fff" }}>to</span>
                <input
                  type="date"
                  data-date-field="to"
                  value={dateRange.to}
                  disabled={isSearching}
                  onFocus={() => {
                    if (!isSearching) {
                      handleDateInputFocus('to');
                    }
                  }}
                  onChange={e => {
                    // COMPLETELY block onChange during auto-population detection OR while searching
                    if (!blockFilterUpdates.to && !isSearching) {
                      const val = e.target.value;
                      setDateRange(prev => ({ ...prev, to: /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : "" }));
                    }
                  }}
                  style={{
                    borderRadius: 6,
                    border: "1px solid #1976d2",
                    padding: "2px 6px",
                    background: "#fff",
                    color: "#232b4a",
                    cursor: isSearching ? "not-allowed" : "auto",
                    opacity: isSearching ? 0.5 : 1,
                  }}
                />
              </div>
            </label>

            <button
              type="button"
              disabled={isSearching}
              style={{
                background: "#1cf1d1",
                color: "#232b4a",
                border: "none",
                borderRadius: 8,
                padding: "8px 20px",
                fontWeight: 600,
                fontSize: "1.1em",
                cursor: isSearching ? "not-allowed" : "pointer",
                boxShadow: "0 1px 4px #1a298055",
                marginTop: 12,
                alignSelf: "center",
                opacity: isSearching ? 0.5 : 1,
              }}
              onClick={() => {
                if (!isSearching) {
                  setFilterOpen(false);
                }
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div
        className="searchtools-handle"
        style={{
          width: 44,
          height: 6,
          borderRadius: 3,
          background: "rgba(255,255,255,0.35)",
          margin: "10px auto 0 auto",
          boxShadow: "0 1px 4px #0002",
          cursor: "ns-resize",
          touchAction: "none",
          userSelect: "none",
          transition: "background 0.2s",
        }}
      />
    </div>
  );
});
