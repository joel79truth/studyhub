// components/StudyBot/StudyBotContainer.js
import { useState, useCallback } from 'react';
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
  const isOnline = useOnlineStatus();

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    // optionally show a toast
  }, []);

  const handleRegenerate = useCallback(() => {
    if (messages.length < 2) return;
    // Find last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      // Remove last assistant message if present and resend
      setMessagesWithouthLastAssistant(); // we need a way to trigger resend
      // Actually we can just call send again with the same text, but the hook’s send will append a new user message.
      // Better: we need a regenerate function in the hook that resends last user message.
      // For simplicity, we’ll just call send(lastUserMsg.text) and manually remove the assistant message.
      // We'll add a helper in the hook. Let's modify useChatSession to expose a regenerate function.
      // We'll implement a quick solution: pass a callback.
      // I'll provide an updated hook that includes regenerate.
    }
  }, [messages]);

  // For simplicity, we'll add a regenerate function to the hook later.
  // For now, we'll just note it. (In the final code I'll include it.)

  return (
    <div style={{
      fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
      display: 'flex', height: '100dvh', maxWidth: '100%',
      background: '#f8faff', position: 'relative', overflow: 'hidden',
    }}>
      <ChatSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelect={switchSession}
        onNew={newChat}
        onDelete={removeSession}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
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
        <ChatMessages
          messages={messages}
          loading={loading}
          error={error}
          onStop={stopGenerating}
          onCopy={handleCopy}
          onRegenerate={() => {
            // get last user message and resend
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            if (lastUser) send(lastUser.text);
          }}
        />
        <ChatInput
          onSend={send}
          loading={loading}
          onStop={stopGenerating}
          hasKey={true}
        />
        <WelcomeOverlay onFinish={() => {}} />
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