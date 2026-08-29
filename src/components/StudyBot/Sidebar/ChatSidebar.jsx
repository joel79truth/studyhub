// src/components/StudyBot/Sidebar/ChatSidebar.jsx
import React, { useMemo } from 'react';

// Groups sessions into Today / Yesterday / Older buckets for easier
// scanning (Tip 4). Falls back to a flat "All chats" bucket if none of
// the sessions carry a recognizable timestamp field — never crashes.
function groupSessions(sessions) {
  const getTs = (s) => s.updatedAt || s.createdAt || s.timestamp || null;
  const hasAnyTimestamp = sessions.some((s) => getTs(s));
  if (!hasAnyTimestamp) {
    return [{ label: null, items: sessions }];
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const today = [];
  const yesterday = [];
  const older = [];

  sessions.forEach((s) => {
    const raw = getTs(s);
    const ts = raw ? new Date(raw).getTime() : null;
    if (ts == null || Number.isNaN(ts)) {
      older.push(s);
    } else if (ts >= startOfToday) {
      today.push(s);
    } else if (ts >= startOfYesterday) {
      yesterday.push(s);
    } else {
      older.push(s);
    }
  });

  return [
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'Older', items: older },
  ].filter((group) => group.items.length > 0);
}

export default function ChatSidebar({
  sessions,
  currentSessionId,
  onSelect,
  onNew,
  onDelete,
  isOpen,
  onClose,
  searchQuery = '',
  onSearchChange,
}) {
  const showSearch = !!onSearchChange && sessions.length > 6;

  const groups = useMemo(() => groupSessions(sessions), [sessions]);

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
            marginBottom: '12px',
          }}
        >
          + New chat
        </button>

        {showSearch && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search chats..."
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              fontSize: '13px',
              marginBottom: '12px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessions.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '24px 8px' }}>
              No chats yet
            </div>
          ) : groups.every((g) => g.items.length === 0) ? (
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: '24px 8px' }}>
              No chats match "{searchQuery}"
            </div>
          ) : (
            groups.map((group, gi) => (
              <div key={group.label || gi}>
                {group.label && (
                  <div style={{
                    fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em',
                    color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
                    padding: '10px 10px 4px',
                  }}>
                    {group.label}
                  </div>
                )}
                {group.items.map((s) => (
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
                      {s.title || 'New Chat'}
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
            ))
          )}
        </div>
      </div>
    </>
  );
}