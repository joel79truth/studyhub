import { createContext, useState, useCallback } from 'react';

export const UserContext = createContext();

const STORAGE_KEY_NAME = 'sb_user_name';
const STORAGE_KEY_SUBJECT = 'sb_subject';
const STORAGE_KEY_HISTORY = 'sb_chat_history';

export function UserProvider({ children }) {
  const [user, setUser] = useState({
    name: localStorage.getItem(STORAGE_KEY_NAME) || '',
    subject: localStorage.getItem(STORAGE_KEY_SUBJECT) || '',
    history: JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]'),
    hasCompletedOnboarding: !!localStorage.getItem(STORAGE_KEY_NAME),
  });

  const updateUser = useCallback((updates) => {
    setUser(prev => {
      const next = { ...prev, ...updates };
      if (updates.name !== undefined) localStorage.setItem(STORAGE_KEY_NAME, next.name);
      if (updates.subject !== undefined) localStorage.setItem(STORAGE_KEY_SUBJECT, next.subject);
      if (updates.history !== undefined) localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(next.history));
      return next;
    });
  }, []);

  const addToHistory = useCallback((messageText) => {
    setUser(prev => {
      const newHistory = [...prev.history, { text: messageText, timestamp: Date.now() }].slice(-10);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(newHistory));
      return { ...prev, history: newHistory };
    });
  }, []);

  return (
    <UserContext.Provider value={{ user, updateUser, addToHistory }}>
      {children}
    </UserContext.Provider>
  );
}