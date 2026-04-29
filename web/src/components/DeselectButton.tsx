export function DeselectButton({
  setSelected,
  recordingsListRef,
}: {
  setSelected: (sel: string[]) => void
  recordingsListRef: React.RefObject<HTMLDivElement | null>
}) {
  function handleDeselectAll() {
    setSelected([])
  }
  return (
    <button
      className="deselect-btn recordings-list-action-btn"
      onMouseDown={(e) => {
        e.preventDefault() // Prevent the button from stealing focus
        recordingsListRef?.current?.focus()
      }}
      onClick={handleDeselectAll}
      title="Deselect all"
      style={{
        background: '#444',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '10px 18px',
        fontWeight: 700,
        fontSize: '1.1em',
        boxShadow: '0 2px 8px #1a2980aa',
        cursor: 'pointer',
      }}
    >
      ×
    </button>
  )
}
