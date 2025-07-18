export function ReloadButton() {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 32,
        zIndex: 2000,
        background: 'rgba(30,30,30,0.85)',
        borderRadius: 12,
        padding: '6px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 2px 8px #1a2980aa',
      }}
    >
      <div className="reload-btn-container">
        <button
          onClick={() => window.location.reload()}
          className="reload-btn"
          title="Reload Page"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 10a6 6 0 1 1 2.2 4.6" stroke="#fff" strokeWidth="2" fill="none" />
            <path d="M2 14v3h3" stroke="#fff" strokeWidth="2" fill="none" />
          </svg>
          Reload
        </button>
      </div>
    </div>
  );
}
