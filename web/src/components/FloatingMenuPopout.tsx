import React from 'react';
import { BatchDeleteButton } from './BatchDeleteButton';
import { DeselectButton } from './DeselectButton';
import type { Recording } from '../App';

interface FloatingMenuPopoutProps {
  open: boolean;
  selected: string[];
  setSelected: (sel: string[]) => void;
  activeStreamId: string;
  cachedRecordings: Recording[];
  setRecordings: (recs: Recording[]) => void;
  recordingsListRef: React.RefObject<HTMLDivElement | null>;
}

export function FloatingMenuPopout({
  open,
  selected,
  setSelected,
  activeStreamId,
  cachedRecordings,
  setRecordings,
  recordingsListRef,
}: FloatingMenuPopoutProps) {
  return (
    <div className={`floating-menu-popout${open ? ' open' : ''}`}>
      {/* Action buttons in their own block, with margin */}
      {selected.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 12,
            width: '100%',
            justifyContent: 'center',
          }}
        >
          <BatchDeleteButton
            streamId={activeStreamId}
            count={selected.length}
            selected={selected}
            recordings={cachedRecordings}
            setRecordings={setRecordings}
            setSelected={setSelected}
            recordingsListRef={recordingsListRef}
          />
          <DeselectButton setSelected={setSelected} recordingsListRef={recordingsListRef} />
        </div>
      )}
    </div>
  );
}
