import React from 'react';
import { Plus, Trash2, MessageSquare, X } from 'lucide-react';

export default function ChatSidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
  isOpen,
  onClose,
}) {
  return (
    <div className={`chat-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <h2>Chats</h2>
        <button onClick={onNew} className="new-chat-btn">
          <Plus size={18} /> New
        </button>
        <button onClick={onClose} className="close-sidebar"><X size={18} /></button>
      </div>
      <div className="conversation-list">
        {conversations.map(conv => (
          <div
            key={conv.id}
            className={`conversation-item ${conv.id === currentId ? 'active' : ''}`}
            onClick={() => onSelect(conv.id)}
          >
            <MessageSquare size={16} />
            <span className="conv-title">{conv.title || 'New Chat'}</span>
            <button
              className="delete-btn"
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <style jsx>{`
        .chat-sidebar {
          position: fixed;
          top: 0; left: 0;
          width: 280px;
          height: 100vh;
          background: #f8fafc;
          border-right: 1px solid #e2e8f0;
          z-index: 60;
          transform: translateX(-100%);
          transition: transform 0.3s cubic-bezier(0.22,1,0.36,1);
          display: flex;
          flex-direction: column;
          padding: 16px;
          box-shadow: 2px 0 12px rgba(0,0,0,0.05);
        }
        .chat-sidebar.open { transform: translateX(0); }
        .sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .sidebar-header h2 { font-size: 18px; font-weight: 700; margin: 0; color: #0f172a; }
        .new-chat-btn {
          display: flex; align-items: center; gap: 4px;
          background: #3b82f6; color: white; border: none;
          border-radius: 20px; padding: 6px 14px; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: background 0.2s;
        }
        .new-chat-btn:hover { background: #2563eb; }
        .close-sidebar {
          background: none; border: none; cursor: pointer; color: #94a3b8;
        }
        .conversation-list {
          flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
        }
        .conversation-item {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 10px;
          cursor: pointer; transition: background 0.15s;
          color: #1e293b; font-size: 14px;
        }
        .conversation-item:hover { background: #e2e8f0; }
        .conversation-item.active { background: #dbeafe; color: #1d4ed8; font-weight: 600; }
        .conv-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .delete-btn {
          background: none; border: none; color: #94a3b8;
          cursor: pointer; padding: 4px; border-radius: 6px;
          transition: color 0.2s, background 0.2s;
        }
        .delete-btn:hover { color: #ef4444; background: #fee2e2; }
        @media (max-width: 640px) { .chat-sidebar { width: 100%; } }
      `}</style>
    </div>
  );
}