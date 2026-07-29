// routes/chat.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getStudentContext } from '../utils/studentContext.js';
import { buildSystemPrompt } from '../utils/systemPrompt.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// GET /api/chat/sessions – list user's sessions
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, title, created_at, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/sessions – create new session
router.post('/sessions', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    const { data, error } = await supabaseAdmin
      .from('chat_sessions')
      .insert({
        user_id: req.user.id,
        title: title || 'New chat',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/sessions/:id/messages – load messages
router.get('/sessions/:id/messages', requireAuth, async (req, res) => {
  try {
    // Verify session belongs to user
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('session_id', req.params.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/sessions/:id
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('chat_sessions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/sessions/:id/messages – stream a response and persist
router.post('/sessions/:id/messages', requireAuth, async (req, res) => {
  const { message } = req.body; // user message text
  if (!message) return res.status(400).json({ error: 'Message text required.' });

  const sessionId = req.params.id;
  const userId = req.user.id;

  // 1. Verify session ownership
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, title')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (!session) return res.status(404).json({ error: 'Session not found.' });

  try {
    // 2. Save user message
    const { error: msgErr } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'user',
        content: message,
      });

    if (msgErr) throw msgErr;

    // 3. Get student context and build system prompt
    const context = await getStudentContext(userId);
    const systemPrompt = buildSystemPrompt(context);

    // 4. Fetch previous messages for the session to give context
    const { data: history } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    // 5. Prepare Gemini contents array (system prompt as first user+model turn)
    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood! I am StudyBot.' }] },
      ...history.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
    ];

    // 6. Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // if using nginx
    });

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContentStream({
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });

    let fullResponse = '';

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
      }
    }

    // 7. Save assistant message to DB
    await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'model',
        content: fullResponse,
      });

    // 8. Update session title if it’s still "New chat" (use first few words of user message)
    if (session.title === 'New chat') {
      const newTitle = message.substring(0, 50) + (message.length > 50 ? '...' : '');
      await supabaseAdmin
        .from('chat_sessions')
        .update({ title: newTitle, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    } else {
      // update timestamp
      await supabaseAdmin
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Stream error:', err);
    // If headers already sent, we can't send JSON error; just end stream
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

export default router;