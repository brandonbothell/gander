import { authFetch } from '../main'
import type { RecordingType } from './Recording'

interface BatchDeleteButtonProps {
  streamId: string
  count: number
  selected: string[]
  recordings: RecordingType[]
  setRecordings: (recs: RecordingType[]) => void
  setSelected: (sel: string[]) => void
  recordingsListRef: React.RefObject<HTMLDivElement | null>
}

export function BatchDeleteButton({
  streamId,
  count,
  selected,
  recordings,
  setRecordings,
  setSelected,
  recordingsListRef,
}: BatchDeleteButtonProps) {
  async function handleBatchDelete() {
    if (!selected.length) return
    if (!window.confirm(`Delete ${selected.length} recordings?`)) return
    const res = await authFetch(`/api/recordings/${streamId}/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: selected }),
    })
    if (res.ok) {
      setRecordings(recordings.filter((r) => !selected.includes(r.filename)))
      setSelected([])
    } else {
      alert('Failed to delete recordings.')
    }
  }

  return (
    <button
      className="batch-delete-btn recordings-list-action-btn"
      onMouseDown={(e) => {
        e.preventDefault() // Prevent the button from stealing focus
        recordingsListRef?.current?.focus()
      }}
      onClick={handleBatchDelete}
      style={{
        background: '#c00',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '10px 22px',
        fontWeight: 700,
        fontSize: '1.1em',
        boxShadow: '0 2px 8px #1a2980aa',
        cursor: 'pointer',
      }}
    >
      Delete Selected ({count})
    </button>
  )
}
