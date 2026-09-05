import { useState, useRef, useCallback, useEffect } from 'react';
import { getAuthToken } from '../utils/auth'; // your supabase helper
import { API_BASE_URL } from '../lib/apiConfig';

export function useLunaChat(currentPage, fileId, context, pdf) {  // ← added pdf
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lunaMood, setLunaMood] = useState('idle');
  const [showCelebration, setShowCelebration] = useState(false);
  const [isTeachMode, setIsTeachMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const messagesRef = useRef([]);

  // Cache for extracted text
  const pageTextCache = useRef({});

  // Extract text for a given page (cached)
  const getPageText = useCallback(async (pageNum) => {
    if (!pdf || !pageNum) return '';
    if (pageTextCache.current[pageNum] !== undefined) {
      return pageTextCache.current[pageNum];
    }
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ');
      pageTextCache.current[pageNum] = text;
      return text;
    } catch (err) {
      console.error('Failed to extract text for page', pageNum, err);
      return '';
    }
  }, [pdf]);

  // Preload text for current page whenever it changes (optional but helps latency)
  useEffect(() => {
    if (pdf && currentPage) {
      getPageText(currentPage);
    }
  }, [currentPage, pdf, getPageText]);

  const sendMessage = useCallback(async (userMessage) => {
    const text = (typeof userMessage === 'string' ? userMessage : input).trim();
    if (!text || isLoading) return;

    const updated = [...messagesRef.current, { role: 'user', content: text }];
    setMessages(updated);
    messagesRef.current = updated;
    setInput('');
    setIsLoading(true);
    setLunaMood('thinking');

    // 🔍 Fetch the current page’s text (waits if not cached yet)
    const pageText = await getPageText(currentPage);
    console.log(`📄 Page ${currentPage} text length: ${pageText.length}`);

    const token = await getAuthToken();
    const payload = {
      fileId,
      pageNumber: currentPage,
      pageText,               // ✅ now real text
      question: text,
      history: updated.slice(-6).filter(m => m.content.trim()),
      mode: isTeachMode ? 'teach' : 'assist',
      context,
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/luna/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);
      setLunaMood('replying');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n\n')) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6);
          if (json === '[DONE]') continue;
          try { const d = JSON.parse(json); if (d.token) reply += d.token; } catch {}
        }
        setMessages(prev => {
          const arr = [...prev];
          const last = arr[arr.length - 1];
          if (last?.role === 'assistant') arr[arr.length - 1] = { ...last, content: reply };
          return arr;
        });
      }

      setMessages(prev => {
        const arr = [...prev];
        const last = arr[arr.length - 1];
        if (last?.role === 'assistant') arr[arr.length - 1] = { ...last, content: reply, isStreaming: false };
        return arr;
      });

      setLunaMood('happy');
      setShowCelebration(true);
      setTimeout(() => { setShowCelebration(false); setLunaMood('idle'); }, 2500);
    } catch {
      setLunaMood('idle');
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, currentPage, isTeachMode, fileId, context, getPageText]);

  return {
    messages,
    isLoading,
    input,
    setInput,
    sendMessage,
    isTeachMode,
    setIsTeachMode,
    isFullscreen,
    setIsFullscreen,
    lunaMood,
    showCelebration,
  };
}