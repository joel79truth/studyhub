// components/StudyBot/StudyBotContainer.js
import { useState, useCallback, useMemo } from 'react';
import { UserProvider } from '../../context/UserContext';
import Header from './Header/Header';
import ChatMessages from './Chat/ChatMessages';
import ChatInput from './Chat/ChatInput';
import ChatSidebar from './Sidebar/ChatSidebar';
import OfflineIndicator from './Chat/OfflineIndicator';
import WelcomeOverlay from './Personalisation/WelcomeOverlay';
import { useChatSession } from '../../hooks/useChatSession';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

function ChatApp() {
  const {
    sessions,
    currentSessionId,
    messages,
    loading,
    error,
    send,
    newChat,
    switchSession,
    removeSession,
    stopGenerating,
  } = useChatSession();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [errorDismissed, setErrorDismissed] = useState(false);
  const isOnline = useOnlineStatus();

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    // optionally show a toast
  }, []);

  // Fixed: previous handleRegenerate referenced an undefined
  // setMessagesWithouthLastAssistant() and was never actually wired up to
  // anything — ChatMessages was calling its own separate inline handler.
  // This is now the single source of truth, passed down below.
  const handleRegenerate = useCallback(() => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) send(lastUser.text);
  }, [messages, send]);

  // Tip 2: local, client-side search over sessions — filters the array
  // before it reaches ChatSidebar, so it doesn't touch useChatSession's
  // fetching/caching at all. Only shown once there's enough sessions to
  // make searching worthwhile.
  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return sessions;
    const q = sessionSearch.toLowerCase();
    return sessions.filter(s =>
      (s.title || s.name || '').toLowerCase().includes(q)
    );
  }, [sessions, sessionSearch]);

  // Tip 1: lets WelcomeOverlay (or Header) adapt its copy for someone who
  // already has chat history vs. a first-time visitor, instead of treating
  // every load identically. NOTE: WelcomeOverlay's own implementation isn't
  // shown here — this only wires the prop through; the component itself
  // needs to actually branch on it.
  const isReturningUser = sessions.length > 0;

  return (
    <div style={{
      fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
      display: 'flex', height: '100dvh', maxWidth: '100%',
      background: '#f8faff', position: 'relative', overflow: 'hidden',
    }}>
      <ChatSidebar
        sessions={filteredSessions}
        currentSessionId={currentSessionId}
        onSelect={switchSession}
        onNew={newChat}
        onDelete={removeSession}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        searchQuery={sessions.length > 6 ? sessionSearch : ''}
        onSearchChange={sessions.length > 6 ? setSessionSearch : undefined}
      />
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        maxWidth: '480px', margin: '0 auto', width: '100%',
        borderLeft: '1px solid #e8edf8', borderRight: '1px solid #e8edf8',
      }}>
        <OfflineIndicator />
        <Header
          loading={loading}
          onNewChat={newChat}
          onSettings={() => {}}
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        />

        {/* Tip 3: a visible, dismissible status strip instead of `error`
            sitting unused as a prop passed further down with no clear
            surface-level acknowledgement in this container. */}
        {error && !errorDismissed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', fontSize: 13, color: '#b91c1c',
            background: '#fef2f2', borderBottom: '1px solid #fecaca',
          }}>
            <span style={{ flex: 1 }}>⚠️ {typeof error === 'string' ? error : 'Something went wrong. Please try again.'}</span>
            <button
              onClick={() => setErrorDismissed(true)}
              style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <ChatMessages
          messages={messages}
          loading={loading}
          error={error}
          onStop={stopGenerating}
          onCopy={handleCopy}
          onRegenerate={handleRegenerate}
        />
        <ChatInput
          onSend={send}
          loading={loading}
          onStop={stopGenerating}
          hasKey={true}
        />
        <WelcomeOverlay onFinish={() => {}} isReturningUser={isReturningUser} />
      </div>
    </div>
  );
}

export default function StudyBotContainer() {
  return (
    <UserProvider>
      <ChatApp />
    </UserProvider>
  );
}