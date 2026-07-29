// src/services/api.js
import { supabase } from '../supabase'; // adjust path to your supabase client

const BASE_URL = '/api/chat';

// Helper: get the current access token
async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export async function fetchSessions() {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/sessions`, { headers });
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

export async function createSession(title = 'New chat') {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to create session');
  return res.json();
}

export async function deleteSession(id) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/sessions/${id}`, { method: 'DELETE', headers });
  if (!res.ok) throw new Error('Failed to delete session');
  return res.json();
}

export async function fetchMessages(sessionId) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/messages`, { headers });
  if (!res.ok) throw new Error('Failed to load messages');
  return res.json();
}

export function sendMessageStream(sessionId, message, { onToken, onDone, onError, signal }) {
  // For streaming, we need to attach the token inside the fetch call
  const startStream = async () => {
    try {
      const headers = await getAuthHeaders();
      // Note: signal is passed from the caller (useChatSession)
      const response = await fetch(`${BASE_URL}/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message }),
        signal,
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              onDone?.();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.token) onToken?.(parsed.token);
              if (parsed.error) onError?.(parsed.error);
            } catch (e) {
              // ignore malformed chunks
            }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      onError?.(err.message);
    }
  };

  startStream();
}