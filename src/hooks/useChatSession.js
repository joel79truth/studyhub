// src/hooks/useChatSession.js
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  fetchSessions,
  createSession,
  deleteSession,
  fetchMessages,
  sendMessageStream,
} from '../services/api';

export function useChatSession() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortControllerRef = useRef(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchSessions();
      setSessions(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const newChat = useCallback(async () => {
    try {
      const session = await createSession();
      setSessions(prev => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([]);
    } catch (e) {
      setError('Failed to create new chat.');
    }
  }, []);

  const switchSession = useCallback(async (id) => {
    setCurrentSessionId(id);
    setLoading(false);
    setError('');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    try {
      const msgs = await fetchMessages(id);
      setMessages(msgs.map(m => ({ role: m.role, text: m.content })));
    } catch (e) {
      setError('Failed to load messages.');
    }
  }, []);

  const removeSession = useCallback(async (id) => {
    try {
      await deleteSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) {
        const remaining = sessions.filter(s => s.id !== id);
        if (remaining.length > 0) {
          switchSession(remaining[0].id);
        } else {
          newChat();
        }
      }
    } catch (e) {
      setError('Failed to delete chat.');
    }
  }, [currentSessionId, sessions, switchSession, newChat]);

  const send = useCallback((text) => {
    if (!currentSessionId || loading) return;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMsg = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setError('');

    const assistantMsg = { role: 'model', text: '' };
    setMessages(prev => [...prev, assistantMsg]);

    sendMessageStream(currentSessionId, text, {
      signal: controller.signal,
      onToken: (token) => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'model') {
            updated[updated.length - 1] = { ...last, text: last.text + token };
          }
          return updated;
        });
      },
      onDone: () => {
        setLoading(false);
        abortControllerRef.current = null;
      },
      onError: (err) => {
        setLoading(false);
        setError(err);
        setMessages(prev => prev.filter(m => m.role === 'user' || m.text !== ''));
        abortControllerRef.current = null;
      },
    });
  }, [currentSessionId, loading]);

  const stopGenerating = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, []);

  const regenerate = useCallback(() => {
    if (loading) return;
    setMessages(prev => {
      const newMsgs = [...prev];
      let lastUserIndex = -1;
      for (let i = newMsgs.length - 1; i >= 0; i--) {
        if (newMsgs[i].role === 'user') {
          lastUserIndex = i;
          break;
        }
      }
      if (lastUserIndex === -1) return prev;
      const trimmed = newMsgs.slice(0, lastUserIndex + 1);
      setTimeout(() => send(trimmed[lastUserIndex].text), 0);
      return trimmed;
    });
  }, [loading, send]);

  useEffect(() => {
    if (sessions.length === 0 && !currentSessionId) {
      newChat();
    } else if (sessions.length > 0 && !currentSessionId) {
      switchSession(sessions[0].id);
    }
  }, [sessions, currentSessionId, newChat, switchSession]);

  return {
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
    regenerate,
  };
}