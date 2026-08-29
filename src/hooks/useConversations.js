import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabase'; // adjust to your actual supabase client path
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'luna_offline_data';

export function useConversations(user) {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadFromLocal = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  const saveToLocal = useCallback((data) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setConversations(data || []);
      if (data.length === 0) {
        await createNewConversation();
      } else {
        setCurrentConversationId(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching conversations:', err);
      const localData = loadFromLocal();
      if (localData) {
        setConversations(localData.conversations || []);
        setCurrentConversationId(localData.currentId || null);
      }
    } finally {
      setLoading(false);
    }
  }, [user, loadFromLocal]);

  const createNewConversation = useCallback(async (title = 'New Chat') => {
    if (!user) return null;
    const newConv = {
      id: uuidv4(),
      user_id: user.id,
      title,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      const { data, error } = await supabase
        .from('conversations')
        .insert(newConv)
        .select()
        .single();
      if (error) throw error;
      setConversations(prev => [data, ...prev]);
      setCurrentConversationId(data.id);
      setMessages([]);
      const localData = loadFromLocal() || { conversations: [], currentId: null };
      localData.conversations = [data, ...localData.conversations];
      localData.currentId = data.id;
      saveToLocal(localData);
      return data;
    } catch (err) {
      console.error('Error creating conversation:', err);
      // offline fallback
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversationId(newConv.id);
      setMessages([]);
      const localData = loadFromLocal() || { conversations: [], currentId: null };
      localData.conversations = [newConv, ...localData.conversations];
      localData.currentId = newConv.id;
      saveToLocal(localData);
      return newConv;
    }
  }, [user, loadFromLocal, saveToLocal]);

  const switchConversation = useCallback(async (convId) => {
    if (!convId) return;
    setCurrentConversationId(convId);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages(data || []);
      const localData = loadFromLocal() || { conversations: [], currentId: null };
      localData.currentId = convId;
      saveToLocal(localData);
    } catch (err) {
      console.error('Error fetching messages:', err);
      const localData = loadFromLocal();
      if (localData && localData.messages && localData.messages[convId]) {
        setMessages(localData.messages[convId]);
      } else {
        setMessages([]);
      }
    }
  }, [loadFromLocal, saveToLocal]);

  const sendMessage = useCallback(async (conversationId, userMsg, aiMsg) => {
    if (!conversationId) return;
    const newMessages = [
      { conversation_id: conversationId, role: 'user', content: userMsg },
      { conversation_id: conversationId, role: 'assistant', content: aiMsg },
    ];
    const optimistic = [
      ...messages,
      { id: uuidv4(), role: 'user', content: userMsg, created_at: new Date().toISOString() },
      { id: uuidv4(), role: 'assistant', content: aiMsg, created_at: new Date().toISOString() },
    ];
    setMessages(optimistic);

    try {
      const { error } = await supabase
        .from('messages')
        .insert(newMessages);
      if (error) throw error;
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
      await switchConversation(conversationId);
    } catch (err) {
      console.error('Error saving messages:', err);
      const localData = loadFromLocal() || { conversations: [], currentId: null, messages: {} };
      if (!localData.messages) localData.messages = {};
      if (!localData.messages[conversationId]) localData.messages[conversationId] = [];
      localData.messages[conversationId] = optimistic;
      saveToLocal(localData);
    }
  }, [messages, loadFromLocal, saveToLocal, switchConversation]);

  const deleteConversation = useCallback(async (convId) => {
    try {
      await supabase.from('conversations').delete().eq('id', convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (currentConversationId === convId) {
        const remaining = conversations.filter(c => c.id !== convId);
        if (remaining.length > 0) {
          await switchConversation(remaining[0].id);
        } else {
          await createNewConversation();
        }
      }
      const localData = loadFromLocal() || { conversations: [], currentId: null, messages: {} };
      localData.conversations = localData.conversations.filter(c => c.id !== convId);
      delete localData.messages[convId];
      saveToLocal(localData);
    } catch (err) {
      console.error('Error deleting conversation:', err);
      // fallback: local only
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (currentConversationId === convId) {
        const remaining = conversations.filter(c => c.id !== convId);
        if (remaining.length > 0) {
          setCurrentConversationId(remaining[0].id);
          switchConversation(remaining[0].id);
        } else {
          createNewConversation();
        }
      }
    }
  }, [conversations, currentConversationId, switchConversation, createNewConversation, loadFromLocal, saveToLocal]);

  useEffect(() => {
    if (user) {
      fetchConversations();
    } else {
      setConversations([]);
      setCurrentConversationId(null);
      setMessages([]);
    }
  }, [user, fetchConversations]);

  return {
    conversations,
    currentConversationId,
    messages,
    loading,
    createNewConversation,
    switchConversation,
    sendMessage,
    deleteConversation,
  };
}