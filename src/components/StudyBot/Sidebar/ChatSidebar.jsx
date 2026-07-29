// src/components/StudyBot/Sidebar/ChatSidebar.jsx
export default function ChatSidebar({
  sessions,
  currentSessionId,
  onSelect,
  onNew,
  onDelete,
  isOpen,
  onClose,
}) {
  return (
    <>
      {isOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
            zIndex: 30,
          }}
          onClick={onClose}
        />
      )}
      <div style={{
        position: 'fixed',
        top: 0,
        left: isOpen ? 0 : '-300px',
        width: '280px',
        height: '100dvh',
        background: '#1e2d5a',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        transition: 'left 0.3s ease',
        zIndex: 40,
        padding: '16px',
        boxShadow: '2px 0 10px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>StudyBot</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
        <button
          onClick={onNew}
          style={{
            width: '100%', padding: '10px', borderRadius: '8px',
            border: '1px solid #3b82f6', background: 'transparent',
            color: '#fff', fontWeight: '600', cursor: 'pointer',
            marginBottom: '16px',
          }}
        >
          + New chat
        </button>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessions.map(s => (
            <div
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', borderRadius: '6px',
                background: s.id === currentSessionId ? '#3b82f6' : 'transparent',
                cursor: 'pointer',
                marginBottom: '4px',
              }}
              onClick={() => {
                onSelect(s.id);
                onClose?.();
              }}
            >
              <span style={{ fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                style={{
                  background: 'none', border: 'none', color: '#fff',
                  fontSize: '14px', cursor: 'pointer', padding: '2px 4px',
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}