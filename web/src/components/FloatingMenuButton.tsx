export function FloatingMenuButton({
  open,
  onClick,
}: {
  open: boolean
  onClick: () => void
}) {
  return (
    <div className="floating-menu-btn">
      <button aria-label="Show controls" onClick={onClick}>
        {open ? '×' : '☰'}
      </button>
    </div>
  )
}
