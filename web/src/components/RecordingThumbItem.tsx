import type { RefObject } from "react";
import { useSignedUrl } from "../hooks/useSignedUrl";

export interface RecordingThumbItemProps {
  streamId: string;
  filename: string;
  checked: boolean;
  hovered: boolean;
  anySelected: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onClick: () => void;
  onCheckboxChange: (checked: boolean) => void;
  nickname?: string;
  viewed: boolean;
  recordingsListRef: RefObject<HTMLDivElement | null>;
}

export function formatTimestamp(filename: string) {
  const match = filename.match(/motion_(.+)\.mp4/);
  if (!match) return filename;
  const iso = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
    (_m, h, m2, s, ms) => `T${h}:${m2}:${s}.${ms}Z`
  );
  const date = new Date(iso);
  return isNaN(date.getTime()) ? match[1] : date.toLocaleString();
}

export function RecordingThumbItem({
  streamId,
  filename,
  checked,
  hovered,
  anySelected,
  onMouseEnter,
  onMouseLeave,
  onTouchStart,
  onTouchEnd,
  onTouchCancel,
  onClick,
  onCheckboxChange,
  nickname,
  viewed,
  recordingsListRef
}: RecordingThumbItemProps) {
  const thumbUrl = useSignedUrl(filename.replace(/\.mp4$/, '.jpg'), 'thumbnail', streamId);

  return (
    <div
      className="recording-thumb-item"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <button
        className="recording-thumb-link"
        tabIndex={-1}
        onMouseDown={e => {
          // Prevent button from stealing focus from the recordings list
          e.preventDefault();
        }}
        onClick={e => {
          if (anySelected) {
            // Toggle selection instead of navigating
            e.stopPropagation();
            e.preventDefault();
            onCheckboxChange(!checked);
            return;
          }
          onClick();
        }}
        onTouchEnd={() => {
          // ...existing logic...
          // Refocus the recordings list if it lost focus
          if (recordingsListRef.current && document.activeElement !== recordingsListRef.current) {
            recordingsListRef.current.focus();
          }
        }}
        style={{ position: 'relative' }}
        onContextMenu={e => e.preventDefault()}
      >
        {(anySelected || checked || hovered) && (
          <input
            tabIndex={-1}
            type="checkbox"
            className={`recording-select-checkbox${checked || hovered || anySelected ? ' visible' : ''}`}
            checked={checked}
            onChange={e => onCheckboxChange(e.target.checked)}
            onPointerDown={e => {
              e.stopPropagation();
            }}
            onClick={e => {
              e.stopPropagation();
            }}
          />
        )}
        <img
          src={thumbUrl}
          alt={filename}
          className="recording-thumb"
        />
        {nickname && (
          <span className="recording-nickname">
            {nickname}
          </span>
        )}
        <span className="timestamp">
          {formatTimestamp(filename)}
        </span>
        {!viewed && <span className="new-badge">New</span>}
      </button>
    </div>
  );
}
