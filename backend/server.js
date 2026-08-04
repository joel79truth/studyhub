require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const { Readable } = require('stream');
const path = require('path');
const http = require('http');
const https = require('https');
const JSON5 = require('json5');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const Groq = require('groq-sdk');
const fetch = require('node-fetch'); // for Node < 18; if using Node 18+ you can use global fetch

// ===== INITIALISATION =====

// Firebase Admin SDK
if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_BASE64');
}
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString()
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Supabase clients
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase credentials');
}
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : supabase;

// Google Drive OAuth
if (!process.env.OAUTH_CLIENT_JSON || !process.env.GOOGLE_REFRESH_TOKEN) {
  throw new Error('Missing Google OAuth credentials');
}
const oauthCreds = JSON.parse(process.env.OAUTH_CLIENT_JSON);
const { client_id, client_secret, redirect_uris } =
  oauthCreds.installed || oauthCreds.web;
const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const drive = google.drive({
  version: 'v3',
  auth: oauth2Client,
  httpAgent: httpsAgent,
});

// Groq AI client
if (!process.env.GROQ_API_KEY) {
  console.warn('⚠️  GROQ_API_KEY not set. Luna and StudyBot features will fail.');
}
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Gemini AI
const { GoogleGenerativeAI } = require('@google/generative-ai');
if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY not set. Exam Trainer features will fail.');
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy-key');

// Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

// ===== HELPERS =====

async function uploadToDriveWithRetry(file, maxRetries = 3, baseDelay = 500) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const bufferStream = new Readable();
      bufferStream.push(file.buffer);
      bufferStream.push(null);
      const driveRes = await drive.files.create({
        requestBody: {
          name: file.originalname,
          parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
        },
        media: { mimeType: file.mimetype, body: bufferStream },
        timeout: 30000,
      });
      return driveRes;
    } catch (err) {
      console.error(`Drive attempt ${attempt} failed:`, err.message);
      if (attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Auth middleware (using Supabase)
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error('Unauthorized');
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// Spaced repetition helper
async function updateTopicMastery(userId, topic, correct, course) {
  const { data: current } = await supabaseAdmin
    .from('user_weak_topics')
    .select('mastery')
    .eq('user_id', userId)
    .eq('topic', topic)
    .maybeSingle();

  const oldMastery = current ? current.mastery : 0.5;
  const newMastery = correct
    ? Math.min(1.0, oldMastery + 0.05)
    : Math.max(0.0, oldMastery - 0.03);

  await supabaseAdmin.from('user_weak_topics').upsert({
    user_id: userId,
    topic,
    course: course || null,
    mastery: newMastery,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'user_id,topic' });
}

// AI grading for structured answers
async function gradeStructuredAnswer(questionText, correctAnswer, userAnswer) {
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
  const prompt = `You are an exam grader for a LUANAR student.

Question: "${questionText}"
Model correct answer: "${correctAnswer}"
Student's answer: "${userAnswer}"

Determine if the student's answer is CORRECT or INCORRECT. Be lenient – if the student captures the main points, mark it CORRECT.
Return a JSON object with:
- correct (boolean)
- explanation (string, a friendly explanation of why the answer is correct or incorrect, and a memory tip)

Only JSON, no other text.`;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    text = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON5.parse(text);
    } catch (parseErr) {
      console.error('JSON5 parse error in gradeStructuredAnswer:', parseErr.message);
      return {
        correct: false,
        explanation: 'We could not grade your answer due to a technical issue. Please try again.'
      };
    }

    return {
      correct: parsed.correct,
      explanation: parsed.explanation || (parsed.correct ? 'Well done!' : 'Not quite. The correct answer is: ' + correctAnswer)
    };
  } catch (err) {
    console.error('Error in gradeStructuredAnswer:', err);
    return {
      correct: false,
      explanation: 'An error occurred while grading. Please try again.'
    };
  }
}

// Diagram cropping helper
async function cropAndUploadDiagram(imageBuffer, { x, y, width, height }, mimeType, questionId) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    width = Math.min(Math.round(width), metadata.width - x);
    height = Math.min(Math.round(height), metadata.height - y);
    if (width <= 0 || height <= 0) return null;

    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left: x, top: y, width, height })
      .toBuffer();

    const filePath = `diagrams/${questionId}.png`;
    const { error } = await supabaseAdmin.storage
      .from(process.env.SUPABASE_BUCKET || 'files')
      .upload(filePath, croppedBuffer, { contentType: 'image/png', upsert: true });

    if (error) throw error;

    const publicUrl = supabaseAdmin.storage
      .from(process.env.SUPABASE_BUCKET || 'files')
      .getPublicUrl(filePath).data.publicUrl;

    return publicUrl;
  } catch (err) {
    console.error('Diagram cropping/upload error:', err);
    return null;
  }
}

// Helper functions for past paper extraction
function normalizeQuestion(q) {
  // ensure all fields exist
  return {
    question_type: q.question_type || 'structured',
    question: q.question || '',
    course: q.course || 'Unknown',
    topic: q.topic || 'Unknown',
    marks: q.marks || 0,
    year: q.year || null,
    option_a: q.option_a || '',
    option_b: q.option_b || '',
    option_c: q.option_c || '',
    option_d: q.option_d || '',
    answer: q.answer || '',
    smiles: q.smiles || null,
    latex_math: q.latex_math || null,
    has_diagram: q.has_diagram || false,
    diagram_coordinates: q.diagram_coordinates || null,
    mcq_variant: q.mcq_variant || null,
  };
}

function isValidQuestion(q) {
  return q.question && q.question.trim().length > 0;
}

let sseClients = [];

// ===== ROUTES =====

app.get('/', (req, res) => res.send('Server is running'));

// Programs list
app.get('/api/programs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('programs')
      .select('name')
      .order('name');
    if (error) throw error;
    res.json({ programs: data.map(p => p.name) });
  } catch (err) {
    console.error('Fetch programs error:', err);
    res.status(500).json({ message: 'Failed to load programs' });
  }
});

// Save FCM token
app.post('/save-token', requireAuth, async (req, res) => {
  const { token, program } = req.body;
  if (!token) return res.status(400).json({ message: 'Missing token' });
  try {
    const { error } = await supabaseAdmin
      .from('fcm_tokens')
      .upsert(
        { token, uid: req.user.id, program: program || null },
        { onConflict: 'token' }
      );
    if (error) throw error;
    res.json({ message: 'Token stored', uid: req.user.id });
  } catch (err) {
    console.error('Error saving token:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

// Upload notes
app.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { program, semester, subject } = req.body;
    const file = req.file;
    if (!program || !semester || !subject || !file) {
      return res.status(400).json({ message: 'Missing fields or file' });
    }

    const USE_GDRIVE = file.size > 5 * 1024 * 1024;
    const id = uuidv4();
    const safeName = file.originalname.replace(/\s+/g, '_');
    const filePath = `${program}/${semester}/${subject}/${Date.now()}-${safeName}`;
    let storage_type, storage_ref, publicUrl;

    if (USE_GDRIVE) {
      const driveRes = await uploadToDriveWithRetry(file);
      storage_type = 'gdrive';
      storage_ref = driveRes.data.id;
      publicUrl = `/api/drive/${storage_ref}`;
    } else {
      const { error } = await supabaseAdmin.storage
        .from(process.env.SUPABASE_BUCKET || 'files')
        .upload(filePath, file.buffer, { contentType: file.mimetype });
      if (error) throw error;
      storage_type = 'supabase';
      storage_ref = filePath;
      publicUrl = supabaseAdmin.storage
        .from(process.env.SUPABASE_BUCKET || 'files')
        .getPublicUrl(filePath).data.publicUrl;
    }

    const { error: dbError } = await supabaseAdmin.from('notes').insert([
      {
        id,
        program,
        semester: String(semester),
        course_name: subject,
        filename: file.originalname,
        filepath: storage_ref,
        url: publicUrl,
        storage_type,
        uploader_uid: req.user.id,
        uploader_email: req.user.email || 'unknown@example.com',
        size: String(file.size),
        uploaded_at: new Date().toISOString(),
      },
    ]);

    if (dbError) throw dbError;

    // Push notifications
    const { data: tokens, error: tokenError } = await supabaseAdmin
      .from('fcm_tokens')
      .select('token');
    if (!tokenError && tokens?.length) {
      const tokenList = tokens.map(t => t.token);
      const message = {
        tokens: tokenList,
        notification: {
          title: `📚 New Notes: ${subject}`,
          body: `${file.originalname} for ${program} Sem ${semester}`,
        },
        data: {
          program,
          semester: String(semester),
          subject,
          filename: file.originalname,
          fileId: id,
          url: `/program.html?program=${encodeURIComponent(program)}&semester=${encodeURIComponent(semester)}&subject=${encodeURIComponent(subject)}`,
        },
      };
      const response = await admin.messaging().sendEachForMulticast(message);
      const invalidTokens = [];
      response.responses.forEach((r, i) => {
        if (!r.success && (r.error?.code?.includes('registration-token-not-registered') || r.error?.code?.includes('invalid-registration-token'))) {
          invalidTokens.push(tokenList[i]);
        }
      });
      if (invalidTokens.length) {
        await supabaseAdmin.from('fcm_tokens').delete().in('token', invalidTokens);
      }
    }

    res.json({ message: 'Upload successful', url: publicUrl });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

// Google Drive proxy (direct stream)
app.get('/api/drive/:fileId', async (req, res) => {
  try {
    const driveRes = await drive.files.get(
      { fileId: req.params.fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    driveRes.data.on('error', (streamErr) => {
      console.error('Drive stream error:', streamErr);
      if (!res.headersSent) res.status(500).send('Stream error');
    });
    driveRes.data.pipe(res);
  } catch (err) {
    console.error('Drive proxy error:', err);
    res.status(404).send('File not found');
  }
});

// Metadata endpoint
app.get('/api/metadata', async (req, res) => {
  try {
    const { uid, program } = req.query;
    let query = supabase.from('notes').select('*').order('uploaded_at', { ascending: false });
    if (uid) query = query.eq('uploader_uid', uid);
    if (program) query = query.eq('program', program);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Metadata fetch error:', err);
    res.status(500).json({ message: 'Fetch failed' });
  }
});

// App Update Checker
app.get('/api/update', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('app_updates')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error || !data) {
      return res.status(500).json({ error: 'No version data found' });
    }
    res.json({
      version: data.version,
      forceUpdate: data.force_update,
      title: data.title,
      message: data.message,
      apkUrl: data.apk_url,
    });
  } catch (err) {
    console.error('Update fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit a request
app.post('/submit-request', async (req, res) => {
  try {
    const { topic, course, program, semester, notes, email } = req.body;
    if (!topic || !course || !program || !semester) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const { error } = await supabaseAdmin.from('requests').insert([
      {
        topic,
        course,
        program,
        semester: String(semester),
        notes: notes || '',
        email: email || '',
        created_at: new Date().toISOString(),
      },
    ]);
    if (error) throw error;
    sendNotificationToProgram(program, { topic, course, semester }).catch(console.error);
    res.json({ message: 'Request submitted successfully' });
  } catch (err) {
    console.error('Request error:', err);
    res.status(500).json({ message: 'Failed to submit request' });
  }
});

async function sendNotificationToProgram(program, { topic, course, semester }) {
  const { data: tokens, error } = await supabaseAdmin
    .from('fcm_tokens')
    .select('token')
    .eq('program', program);
  if (error || !tokens?.length) return;
  const tokenList = tokens.map(t => t.token);
  const message = {
    tokens: tokenList,
    notification: {
      title: `📝 New Request: ${topic}`,
      body: `${course} - ${program} Sem ${semester}`,
    },
    data: {
      type: 'request',
      topic,
      course,
      program,
      semester: String(semester),
      url: `/requested-notes.html?program=${encodeURIComponent(program)}&course=${encodeURIComponent(course)}&semester=${semester}&topic=${encodeURIComponent(topic)}`,
    },
  };
  const response = await admin.messaging().sendEachForMulticast(message);
  const invalid = [];
  response.responses.forEach((r, i) => {
    if (!r.success && (r.error?.code?.includes('registration-token-not-registered') || r.error?.code?.includes('invalid-registration-token'))) {
      invalid.push(tokenList[i]);
    }
  });
  if (invalid.length) await supabaseAdmin.from('fcm_tokens').delete().in('token', invalid);
}

app.get('/api/requests', async (req, res) => {
  try {
    const { data, error } = await supabase.from('requests').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ requests: data });
  } catch (err) {
    res.status(500).json({ requests: [] });
  }
});

app.delete('/api/requests/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('requests').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Request deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete request' });
  }
});

// Server-Sent Events
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

app.post('/chat-message', async (req, res) => {
  const { sender, program, text } = req.body;
  if (!sender || !program || !text) return res.status(400).json({ message: 'Missing fields' });
  const newMessage = { sender, program, text, timestamp: new Date().toISOString() };
  const { error } = await supabaseAdmin.from('messages').insert([newMessage]);
  if (error) return res.status(500).json({ message: 'Failed to save message' });
  sseClients.forEach(client => client.write(`data: ${JSON.stringify(newMessage)}\n\n`));
  res.json({ message: 'Message sent', newMessage });
});

// Legacy chat (OpenAI)
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ reply: 'No message provided.' });
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: 'You are a helpful AI tutor...' }, { role: 'user', content: message }],
        temperature: 0.7,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message);
    res.json({ reply: data.choices[0].message.content });
  } catch (err) {
    console.error('GPT error:', err);
    res.status(500).json({ reply: 'AI service error' });
  }
});

// ======== EXAM TRAINER ROUTES ========

// Upload past paper
app.post('/api/exam/upload-past-paper', requireAuth, upload.single('paper'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let imageBuffer = req.file.buffer;
    // Optionally enhance image; we'll skip that step if not defined.
    const imageBase64 = imageBuffer.toString('base64');

    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const prompt = `You are an exam question extractor for LUANAR past papers.
The image may contain multiple‑choice, structured, or diagram‑based questions.

For each question, return a JSON object with:
- question_type: "mcq", "structured", or "diagram"
- question (string, required, never null)
  → IMPORTANT: For mathematical expressions, use LaTeX enclosed in $ for inline or $$ for block.
  → For chemical structures, provide a "smiles" field with the SMILES string.
- course (string, e.g., "Soil and Water Engineering")
- topic (string, e.g., "Irrigation Methods")
- marks (number, if visible)
- year (number or null)

For MCQ:
  - option_a, option_b, option_c, option_d (strings, may contain LaTeX)
  - answer: correct option letter (A,B,C,D)

For structured or diagram:
  - answer: model answer text (may contain LaTeX)
  - if the answer is a chemical structure, also provide a "smiles" string.

For any question that includes a **diagram or image** that is not just text:
  - "has_diagram": true
  - "diagram_coordinates": { x, y, width, height } (approximate pixel coordinates relative to the full image)

Additionally, for every structured question, if possible, create an MCQ variant:
    mcq_variant: {
        question, option_a, option_b, option_c, option_d,
        answer: correct option letter
    }
If not possible, set mcq_variant to null.

Return ONLY a JSON array of these objects, no other text.
 → IMPORTANT: For chemical formulas, use LaTeX subscript notation, e.g., $H_2O$ instead of H2O.
 → For units like m/s, use \text{m/s} (not \text{textm/s}).
→ For multiplication, use \times (not \times \text{times}).
 `;

    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { data: imageBase64, mimeType: req.file.mimetype } }
    ]);

    let text = result.response.text();
    text = text.replace(/```json|```/g, '').trim();

    let questions;
    try {
      questions = JSON5.parse(text).map(normalizeQuestion);
    } catch (parseErr) {
      console.error('JSON5 parse error in past-paper upload:', parseErr.message);
      return res.status(500).json({ error: 'Invalid JSON from AI: ' + parseErr.message });
    }

    const validQuestions = questions.filter(isValidQuestion);
    if (validQuestions.length === 0) {
      return res.status(400).json({ error: 'No valid questions extracted.' });
    }

    const paperId = uuidv4();
    const inserts = [];
    const diagramTasks = [];

    for (let idx = 0; idx < validQuestions.length; idx++) {
      const q = validQuestions[idx];
      const base = {
        course: q.course || 'Unknown',
        topic: q.topic || 'Unknown',
        question: q.question.trim(),
        question_type: q.question_type || 'structured',
        marks: q.marks || 0,
        year: q.year || null,
        paper_id: paperId,
        latex_math: null,
        smiles: q.smiles || null,
        image_url: null,
        diagram_coordinates: q.diagram_coordinates || null,
      };

      if (q.latex_math) {
        base.latex_math = q.latex_math;
      } else {
        const match = base.question.match(/\$\$(.*?)\$\$/);
        if (match) base.latex_math = match[1];
      }

      if (q.question_type === 'mcq') {
        inserts.push({
          ...base,
          option_a: q.option_a || '',
          option_b: q.option_b || '',
          option_c: q.option_c || '',
          option_d: q.option_d || '',
          answer: q.answer || '',
        });
        const baseInsertIndex = inserts.length - 1;
        if (q.has_diagram && q.diagram_coordinates) {
          diagramTasks.push({ coordinates: q.diagram_coordinates, insertIndex: baseInsertIndex });
        }
      } else {
        inserts.push({
          ...base,
          option_a: '',
          option_b: '',
          option_c: '',
          option_d: '',
          answer: q.answer || '',
        });
        const baseInsertIndex = inserts.length - 1;
        if (q.has_diagram && q.diagram_coordinates) {
          diagramTasks.push({ coordinates: q.diagram_coordinates, insertIndex: baseInsertIndex });
        }
        if (q.mcq_variant && q.mcq_variant.question) {
          const variant = q.mcq_variant;
          inserts.push({
            ...base,
            question_type: 'mcq',
            question: variant.question.trim(),
            option_a: variant.option_a || '',
            option_b: variant.option_b || '',
            option_c: variant.option_c || '',
            option_d: variant.option_d || '',
            answer: variant.answer || '',
          });
        }
      }
    }

    const { data: mainData, error: mainError } = await supabaseAdmin
      .from('past_papers')
      .insert(inserts)
      .select();
    if (mainError) throw mainError;

    for (const task of diagramTasks) {
      const row = mainData[task.insertIndex];
      if (!row) continue;
      const url = await cropAndUploadDiagram(imageBuffer, task.coordinates, req.file.mimetype, row.id);
      if (url) {
        await supabaseAdmin.from('past_papers').update({ image_url: url }).eq('id', row.id);
      }
    }

    res.json({ success: true, extracted: mainData.length, paper_id: paperId });
  } catch (err) {
    console.error('Past paper extraction error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generate similar questions
app.post('/api/exam/generate-similar', requireAuth, async (req, res) => {
  const { pastQuestionId } = req.body;
  try {
    const { data: original, error } = await supabaseAdmin
      .from('past_papers')
      .select('*')
      .eq('id', pastQuestionId)
      .single();
    if (error || !original) return res.status(404).json({ error: 'Past question not found' });

    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    let prompt;
    if (original.question_type === 'mcq') {
      prompt = `You are an exam question generator for LUANAR. Take this past MCQ and create 5 new similar MCQs on the same topic. Return a JSON array of objects with fields: question, option_a, option_b, option_c, option_d, answer (correct option letter). Original question: "${original.question}" Options: A) ${original.option_a} B) ${original.option_b} C) ${original.option_c} D) ${original.option_d} Answer: ${original.answer} Topic: ${original.topic}`;
    } else {
      prompt = `You are an exam question generator for LUANAR. Take this past structured question and create 5 new similar structured questions on the same topic. Return a JSON array with fields: question, answer (model answer). Original question: "${original.question}" Model answer: "${original.answer}" Topic: ${original.topic}`;
    }

    const result = await model.generateContent(prompt);
    let text = result.response.text().replace(/```json|```/g, '').trim();

    let generated;
    try {
      generated = JSON5.parse(text);
    } catch (parseErr) {
      console.error('JSON5 parse error in generate-similar:', parseErr.message);
      return res.status(500).json({ error: 'Invalid JSON from AI: ' + parseErr.message });
    }

    const inserts = generated.map(q => ({
      source_past_paper_id: original.id,
      question: q.question,
      option_a: original.question_type === 'mcq' ? (q.option_a || '') : '',
      option_b: original.question_type === 'mcq' ? (q.option_b || '') : '',
      option_c: original.question_type === 'mcq' ? (q.option_c || '') : '',
      option_d: original.question_type === 'mcq' ? (q.option_d || '') : '',
      answer: q.answer,
      course: original.course,
      topic: original.topic,
      question_type: original.question_type,
      difficulty_stage: 'learning'
    }));

    const { data, error: insertErr } = await supabaseAdmin.from('generated_questions').insert(inserts).select();
    if (insertErr) throw insertErr;

    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error('Generate similar error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Adaptive quiz
app.get('/api/exam/quiz', requireAuth, async (req, res) => {
  const { mode = 'learning', count = 10, preferred, courseId } = req.query;
  const userId = req.user.id;

  try {
    const now = new Date().toISOString();

    let courseName = null;
    if (courseId) {
      const { data: courseData, error: courseErr } = await supabaseAdmin
        .from('courses')
        .select('course_name')
        .eq('id', courseId)
        .maybeSingle();
      if (!courseErr && courseData) {
        courseName = courseData.course_name;
      }
    }

    const weakTopicsResp = await supabaseAdmin.from('user_weak_topics').select('*').eq('user_id', userId);
    const weakTopics = weakTopicsResp.data || [];

    async function fetchQuestions(table, typeFilter = null, limitCount = 10) {
      let query = supabaseAdmin.from(table).select('*');
      if (courseName) {
        query = query.eq('course', courseName);
      }
      if (typeFilter) {
        query = query.eq('question_type', typeFilter);
      }
      const { data: all } = await query.limit(limitCount * 2);
      return all || [];
    }

    let questionsPool = [];

    if (mode === 'exam') {
      questionsPool = await fetchQuestions('past_papers', null, count);
    } else if (mode === 'auto') {
      const mix = { mcq: Math.ceil(count * 0.4), structured: Math.ceil(count * 0.3), diagram: Math.ceil(count * 0.1) };
      let fetched = [];
      for (const [type, num] of Object.entries(mix)) {
        if (num === 0) continue;
        let typeQuestions = await fetchQuestions('past_papers', type, num);
        fetched.push(...typeQuestions);
      }
      questionsPool = fetched;
    } else {
      const typeFilter = (preferred && preferred !== 'all') ? preferred : null;
      questionsPool = await fetchQuestions('past_papers', typeFilter, count);
    }

    const { data: seenProgress } = await supabaseAdmin
      .from('user_progress')
      .select('question_id, question_type')
      .eq('user_id', userId);
    const seenIds = seenProgress.map(p => p.question_id);
    const dueProgress = await supabaseAdmin
      .from('user_progress')
      .select('question_id')
      .eq('user_id', userId)
      .lte('next_review', now);
    const dueIds = dueProgress.data.map(p => p.question_id);

    let unseen = [], due = [], other = [];
    for (const q of questionsPool) {
      if (!seenIds.includes(q.id)) unseen.push(q);
      else if (dueIds.includes(q.id)) due.push(q);
      else other.push(q);
    }

    const masteryMap = new Map(weakTopics.map(w => [w.topic, w.mastery]));
    const sortByWeakness = (arr) => {
      return arr.sort((a, b) => {
        const ma = masteryMap.get(a.topic) ?? 1.0;
        const mb = masteryMap.get(b.topic) ?? 1.0;
        return ma - mb;
      });
    };

    due = sortByWeakness(due);
    unseen = sortByWeakness(unseen);
    other = sortByWeakness(other);

    questionsPool = [...due, ...unseen, ...other].slice(0, count);
    res.json({ questions: questionsPool });
  } catch (err) {
    console.error('Get quiz error:', err);
    res.status(500).json({ error: err.message });
  }
});

// AI Grading endpoint
app.post('/api/exam/grade', requireAuth, async (req, res) => {
  const { questionText, correctAnswer, userAnswer } = req.body;
  if (!questionText || !correctAnswer || !userAnswer) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  try {
    const grading = await gradeStructuredAnswer(questionText, correctAnswer, userAnswer);
    res.json(grading);
  } catch (err) {
    console.error('Grade error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Submit answer (with spaced repetition)
app.post('/api/exam/submit-answer', requireAuth, async (req, res) => {
  const { questionId, questionType, correct, topic, userAnswer, questionText, correctAnswer, course } = req.body;
  const userId = req.user.id;

  try {
    const now = new Date();
    let isCorrect = correct;

    if (questionType !== 'mcq' && userAnswer) {
      const grading = await gradeStructuredAnswer(questionText, correctAnswer, userAnswer);
      isCorrect = grading.correct;
      res.locals.explanation = grading.explanation;
    }

    const { data: progress } = await supabaseAdmin
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .eq('question_type', questionType)
      .maybeSingle();

    let repetitions, ease_factor, interval_days, next_review;

    if (progress) {
      repetitions = progress.repetitions;
      ease_factor = progress.ease_factor;
      interval_days = progress.interval_days;

      if (isCorrect) {
        repetitions += 1;
        if (repetitions === 1) interval_days = 1;
        else if (repetitions === 2) interval_days = 6;
        else interval_days = Math.round(interval_days * ease_factor);
        ease_factor = Math.max(1.3, ease_factor + 0.1);
      } else {
        repetitions = 0;
        interval_days = 1;
        ease_factor = Math.max(1.3, ease_factor - 0.2);
      }
      next_review = new Date(now.getTime() + interval_days * 24 * 60 * 60 * 1000);

      await supabaseAdmin
        .from('user_progress')
        .update({
          repetitions,
          ease_factor,
          interval_days,
          next_review: next_review.toISOString(),
          last_reviewed: now.toISOString(),
          correct_count: progress.correct_count + (isCorrect ? 1 : 0),
          incorrect_count: progress.incorrect_count + (isCorrect ? 0 : 1),
        })
        .eq('user_id', userId)
        .eq('question_id', questionId)
        .eq('question_type', questionType);
    } else {
      repetitions = isCorrect ? 1 : 0;
      interval_days = isCorrect ? 1 : 0;
      ease_factor = 2.5;
      next_review = isCorrect
        ? new Date(now.getTime() + interval_days * 24 * 60 * 60 * 1000)
        : now;

      await supabaseAdmin.from('user_progress').insert({
        user_id: userId,
        question_id: questionId,
        question_type: questionType,
        last_reviewed: now.toISOString(),
        next_review: next_review.toISOString(),
        repetitions,
        ease_factor,
        interval_days,
        correct_count: isCorrect ? 1 : 0,
        incorrect_count: isCorrect ? 0 : 1,
      });
    }

    if (topic) {
      await updateTopicMastery(userId, topic, isCorrect, course);
    }

    const response = {
      success: true,
      correct: isCorrect,
    };
    if (res.locals.explanation) {
      response.explanation = res.locals.explanation;
    }

    res.json(response);
  } catch (err) {
    console.error('Submit answer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// AI explanation
app.post('/api/exam/explain', requireAuth, async (req, res) => {
  const { question, correctAnswer, userAnswer } = req.body;
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const prompt = `A student answered a LUANAR exam question incorrectly.
Question: "${question}"
Correct Answer: "${correctAnswer}"
Student's Answer: "${userAnswer}"

Explain in a friendly, coaching tone:
1. Why the correct answer is correct.
2. Why the student's answer is wrong.
3. A memory tip to remember the correct answer.
4. A short related exam tip.
Keep it concise.`;

    const result = await model.generateContent(prompt);
    res.json({ explanation: result.response.text() });
  } catch (err) {
    console.error('Explain error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stats endpoint
app.get('/api/exam/stats', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { count: totalAttempted } = await supabaseAdmin
      .from('user_progress')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const { data: weakTopics } = await supabaseAdmin
      .from('user_weak_topics')
      .select('*')
      .eq('user_id', userId);

    const avgMastery = weakTopics.length
      ? weakTopics.reduce((sum, w) => sum + w.mastery, 0) / weakTopics.length
      : 0.5;

    const attemptsFactor = 1 - Math.exp(-(totalAttempted || 0) / 50);
    const rawScore = avgMastery * attemptsFactor;
    const confidence = Math.min(100, Math.round(rawScore * 100));

    const now = new Date().toISOString();
    const { count: dueCount } = await supabaseAdmin
      .from('user_progress')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .lte('next_review', now);

    res.json({
      totalAttempted: totalAttempted || 0,
      weakTopics: weakTopics.map(w => ({ topic: w.topic, mastery: w.mastery, course: w.course })),
      confidence,
      examReadiness:
        confidence >= 80
          ? 'Ready for Finals'
          : confidence >= 60
          ? 'Getting There'
          : 'Needs Work',
      dueToday: dueCount || 0,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Drawing upload
const uploadDrawing = multer({ storage: multer.memoryStorage() });
app.post('/api/upload-drawing', requireAuth, uploadDrawing.single('image'), async (req, res) => {
  try {
    const { questionId } = req.body;
    const file = req.file;
    if (!file || !questionId) {
      return res.status(400).json({ error: 'Missing file or questionId' });
    }

    const compressedBuffer = await sharp(file.buffer)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `drawings/${questionId}_${Date.now()}${ext}`;

    const { error } = await supabaseAdmin.storage
      .from(process.env.SUPABASE_BUCKET || 'files')
      .upload(filename, compressedBuffer, { contentType: 'image/jpeg', upsert: false });

    if (error) throw error;

    const publicUrl = supabaseAdmin.storage
      .from(process.env.SUPABASE_BUCKET || 'files')
      .getPublicUrl(filename).data.publicUrl;

    res.json({ url: publicUrl });
  } catch (err) {
    console.error('Drawing upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== STUDYBOT – Legacy Gemini chat =====
app.post('/api/studybot/chat', requireAuth, async (req, res) => {
  const { messages, userName, userSubject } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array required.' });
  }

  let systemPrompt = `You are StudyBot, a friendly and knowledgeable AI tutor for university students.`;
  if (userName) {
    systemPrompt += ` The student you are speaking to is named ${userName}.`;
  }
  if (userSubject) {
    systemPrompt += ` Their favourite subject is ${userSubject}.`;
  }
  systemPrompt += ` Your role is to:
- Help students understand difficult academic concepts clearly and simply
- Assist with assignments, essays, research, math, science, coding, and any subject
- Break down complex topics into easy steps
- Give examples, mnemonics, and study tips
- Encourage students and boost their confidence
- Help with exam preparation and revision strategies
- Cite sources or suggest further reading when helpful
Always be encouraging, patient, and supportive. Keep answers focused and student-friendly.`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood! I am StudyBot, ready to help you.' }] },
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      })),
    ];

    const result = await model.generateContent({
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    });

    const reply = result.response.text();
    res.json({ reply });
  } catch (err) {
    console.error('StudyBot Gemini error:', err);
    res.status(500).json({ error: 'AI service error: ' + err.message });
  }
});

// ===== STUDYBOT 2.0 – Streaming Chat with Session History =====

// In‑memory context cache (TTL 60s)
const contextCache = new Map();
function getCachedContext(userId) {
  const entry = contextCache.get(userId);
  if (entry && Date.now() - entry.timestamp < 60000) return entry.data;
  return null;
}
function setCachedContext(userId, data) {
  contextCache.set(userId, { data, timestamp: Date.now() });
}

async function getStudentContext(userId) {
  const cached = getCachedContext(userId);
  if (cached) return cached;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select(
      'program, name, semester, year_of_study, streak, last_active, quizzes_completed, accuracy_rate, total_questions, total_correct, daily_counts, badges'
    )
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) console.error('Profile fetch error:', profileErr);

  let courses = [];
  try {
    const { data: coursesData } = await supabaseAdmin
      .from('courses')
      .select('course_name')
      .eq('user_id', userId);
    courses = (coursesData || []).map(c => c.course_name);
  } catch (e) {}

  let weaknesses = [];
  try {
    const { data: wData } = await supabaseAdmin
      .from('user_weak_topics')
      .select('topic, mastery, course')
      .eq('user_id', userId)
      .order('mastery', { ascending: true })
      .limit(5);
    weaknesses = (wData || []).map(w => ({
      topic: w.topic,
      mastery: w.mastery,
      course: w.course || '',
    }));
  } catch (e) {}

  let strengths = [];
  try {
    const { data: strongTopics } = await supabaseAdmin
      .from('user_weak_topics')
      .select('topic, mastery')
      .eq('user_id', userId)
      .gte('mastery', 0.8)
      .order('mastery', { ascending: false })
      .limit(5);
    strengths = (strongTopics || []).map(s => s.topic);
  } catch (e) {}

  let recentActivity = '';
  try {
    const { data: recentSessions } = await supabaseAdmin
      .from('quiz_sessions')
      .select('completed_at, score, total_questions, course_id, percentage')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(5);

    if (recentSessions && recentSessions.length) {
      const lastSession = recentSessions[0];
      const sessionsToday = recentSessions.filter(s => {
        if (!s.completed_at) return false;
        return new Date(s.completed_at).toDateString() === new Date().toDateString();
      }).length;

      recentActivity = `Last quiz: ${lastSession.percentage || lastSession.score}% on ${new Date(lastSession.completed_at).toLocaleDateString()}. ${sessionsToday} quiz(zes) today.`;
    }

    if (profile?.daily_counts) {
      const today = new Date().toISOString().split('T')[0];
      const todayCount = profile.daily_counts[today] || 0;
      if (todayCount > 0) {
        recentActivity += ` Today's question count: ${todayCount}.`;
      }
    }
  } catch (e) {}

  const upcomingExams = [];
  const studyStreak = profile?.streak || 0;
  const preferredExplanationStyle = 'standard';

  let paperSummaries = '';
  if (courses.length > 0) {
    try {
      const { data: papers } = await supabaseAdmin
        .from('past_papers')
        .select('content, course_name')
        .in('course_name', courses)
        .limit(3);
      paperSummaries = (papers || [])
        .map(p => (p.content || '').substring(0, 200) + '...')
        .join('\n\n');
    } catch (e) {}
  }

  const ctx = {
    name: profile?.name || '',
    program: profile?.program || '',
    semester: profile?.semester || '',
    yearOfStudy: profile?.year_of_study || '',
    courses,
    weaknesses,
    strengths,
    recentActivity,
    upcomingExams,
    studyStreak,
    preferredExplanationStyle,
    paperSummaries,
    quizzesCompleted: profile?.quizzes_completed || 0,
    accuracyRate: profile?.accuracy_rate || 0,
    totalQuestions: profile?.total_questions || 0,
    totalCorrect: profile?.total_correct || 0,
    badges: profile?.badges || [],
    lastActive: profile?.last_active || null,
  };

  setCachedContext(userId, ctx);
  return ctx;
}

function safe(str) {
  if (!str) return '';
  return str.replace(/\n/g, ' ').replace(/\r/g, '');
}

function buildSystemPrompt(context) {
  const {
    name,
    program,
    semester,
    yearOfStudy,
    courses,
    weaknesses,
    strengths,
    recentActivity,
    upcomingExams,
    studyStreak,
    preferredExplanationStyle,
    quizzesCompleted,
    accuracyRate,
    totalQuestions,
    totalCorrect,
    badges,
    paperSummaries
  } = context;

  const s = (v) => (v || "").toString().replace(/\n/g, " ").trim();

  const profile = [];

  if (name) profile.push(`• Name: ${s(name)}`);
  if (program) profile.push(`• Programme: ${s(program)} (Year ${yearOfStudy || "Unknown"}, Semester ${semester || "Unknown"})`);
  if (courses?.length) profile.push(`• Current Courses: ${courses.map(s).join(", ")}`);
  if (strengths?.length) profile.push(`• Strong Areas: ${strengths.join(", ")}`);
  if (weaknesses?.length) profile.push(`• Areas Needing Practice: ${weaknesses.map(w => `${w.topic} (${Math.round(w.mastery * 100)}% mastery)`).join(", ")}`);
  if (accuracyRate != null) profile.push(`• Quiz Accuracy: ${Math.round(accuracyRate * 100)}% (${totalCorrect || 0}/${totalQuestions || 0})`);
  if (studyStreak) profile.push(`• Current Study Streak: ${studyStreak} days`);
  if (badges?.length) profile.push(`• Achievements: ${badges.join(", ")}`);
  if (upcomingExams?.length) profile.push(`• Upcoming Exams: ${upcomingExams.map(e => `${e.course} (${e.daysLeft} days)`).join(", ")}`);

  return `
=========================================
STUDYHUB LUNA SYSTEM PROMPT
=========================================

IDENTITY

You are Luna, the AI Study Mentor inside StudyHub.
You are not customer support.
You are not a search engine.
You are an experienced academic mentor whose mission is to help students genuinely understand what they are learning.
Your success is measured by whether the student understands—not by how quickly you answer.
Your personality should feel like an intelligent senior student who enjoys teaching.
Warm. Natural. Patient. Honest. Curious. Confident. Professional but approachable.
Never sound robotic. Never overuse emojis. Never use unnecessary filler.

-----------------------------------------
PRIMARY MISSION
Your goal is to help students
• understand concepts deeply
• prepare for exams
• solve problems
• improve confidence
• become independent learners

Always teach instead of merely giving answers.
Whenever appropriate explain
• why
• how
• when
• where it is applied
• common mistakes

-----------------------------------------
STUDENT PROFILE
${profile.join("\n")}

${paperSummaries ? `
PAST PAPER KNOWLEDGE
${paperSummaries}
` : ""}

-----------------------------------------
PERSONALISATION
Use the student's profile naturally.
If the student is strong in an area, connect new ideas to that strength.
If they struggle in an area, slow down and explain more carefully.
If exams are approaching, focus on revision and exam techniques.
If they have a study streak, encourage consistency without sounding repetitive.
Never force personal information into every response.

-----------------------------------------
READABILITY RULES (VERY IMPORTANT)
Your responses will primarily be read on mobile devices.
Optimise every response for effortless reading.
Rules:
• Paragraphs must never exceed 3 sentences.
• Prefer 1–2 sentence paragraphs whenever possible.
• Never produce large walls of text.
• Insert blank lines between ideas.
• Use headings for topics.
• Use bullet lists when listing concepts.
• Use numbered steps for procedures.
• Keep sentences concise.
• Every response should feel skimmable within 5 seconds.
If a response becomes long:
Break it into clearly labelled sections instead of writing long continuous paragraphs.
Before sending a response, ask yourself:
"Could a tired student read this comfortably on a phone?"
If not, rewrite it.

SCROLLING RULE
Avoid making students scroll through unnecessary text.
Prefer:
Short explanation
↓
Example
↓
Key takeaway

instead of five long paragraphs.
Every sentence should either
• answer the question
• teach something useful
• prepare the student for the next idea
Remove everything else.

-----------------------------------------
ADAPTIVE TEACHING
Before answering, silently determine what the student actually needs.
Possible intentions include
• understanding a concept
• solving homework
• preparing for exams
• revising
• summarising notes
• generating quiz questions
• checking understanding
Adapt automatically.

Examples
Concept learning → explain deeply
Exam preparation → concise, marks-oriented
Homework → guide before giving answers
Revision → summaries, flashcards, recall questions
Quick question → direct answer first

-----------------------------------------
EXPLANATION STYLE
Follow the student's preferred explanation style: ${preferredExplanationStyle || "Balanced"}
If they appear confused, simplify.
If they request detail, go deeper.
If they request beginner explanations, avoid jargon.
If they request technical depth, use correct terminology while still explaining it.

-----------------------------------------
STANDARD RESPONSE STRUCTURE
Unless another format is clearly better, respond using this flow.
1. Direct Answer – Answer the question immediately. Never hide the answer.
2. Explanation – Teach the reasoning step by step.
3. Example – Use practical examples. Prefer examples related to engineering, agriculture, science, technology, or everyday life.
4. Key Takeaway – Summarise the most important idea.
5. Next Step – Offer one useful continuation.
Examples: "Want a worked example?" "Would you like an exam-style question?" "Want a quick quiz?"

-----------------------------------------
TEACHING PRINCIPLES
Always
Define unfamiliar words.
Explain symbols.
Explain equations.
Explain units.
Compare similar concepts.
Break difficult ideas into smaller pieces.
Use analogies.
Use mnemonics when useful.
Connect ideas together.
Encourage thinking instead of memorisation.

-----------------------------------------
EXAM SUPPORT
Whenever appropriate include
Common mistakes
Exam tips
Likely examiner expectations
Memory tricks
Revision advice
Important definitions
Likely questions

-----------------------------------------
MATHEMATICS
When solving maths, show the reasoning clearly.
Present calculations one step at a time.
Explain why each step is performed.
Never skip directly to the answer unless requested.

-----------------------------------------
PROGRAMMING
When teaching code, explain
• what the code does
• why it works
• common mistakes
• improvements
Keep code clean and readable.

-----------------------------------------
FORMATTING
Optimise for mobile reading.
Use
Short paragraphs
Headings
Bullet points
Numbered steps
Tables when comparing
Bold only important terms.
Avoid giant walls of text.

-----------------------------------------
CONVERSATION
Maintain context naturally.
Do not restart explanations unnecessarily.
Remember what has already been discussed in the current conversation.
Build upon previous answers.

-----------------------------------------
HONESTY
Never invent facts.
If uncertain, say so.
If important information is missing, ask one clear follow-up question.

-----------------------------------------
EMOTIONAL INTELLIGENCE
If a student is frustrated, acknowledge it briefly.
Remain encouraging.
Never shame them.
Never exaggerate praise.
Support progress realistically.

-----------------------------------------
QUALITY CHECK
Before every response silently verify
✓ Did I answer the actual question?
✓ Is the answer easy to read?
✓ Did I teach instead of only answering?
✓ Is the explanation appropriate for this student's level?
✓ Would this help in an exam?
✓ Is there unnecessary information I should remove?

-----------------------------------------
You are Luna.
Your purpose is not simply to answer questions.
Your purpose is to help students learn, think, remember, and succeed.
`;
}

// Chat sessions
app.get('/api/chat/sessions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, title, created_at, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Get sessions error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat/sessions', requireAuth, async (req, res) => {
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
    console.error('Create session error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chat/sessions/:id/messages', requireAuth, async (req, res) => {
  try {
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
    console.error('Get messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chat/sessions/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('chat_sessions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete session error:', err);
    res.status(500).json({ error: err.message });
  }
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many messages, please slow down.' },
});

app.post('/api/chat/sessions/:id/messages', requireAuth, chatLimiter, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message text required.' });

  const sessionId = req.params.id;
  const userId = req.user.id;

  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, title')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (!session) return res.status(404).json({ error: 'Session not found.' });

  try {
    await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'user',
        content: message,
      });

    const context = await getStudentContext(userId);
    const systemContent = buildSystemPrompt(context);

    const { data: history } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    const MAX_HISTORY = 20;
    const recentHistory = (history || []).slice(-MAX_HISTORY);

    const messages = [
      { role: 'system', content: systemContent },
      ...recentHistory.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    ];

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    });

    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ token: content })}\n\n`);
      }
    }

    await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'model',
        content: fullResponse,
      });

    if (session.title === 'New chat') {
      const newTitle = message.substring(0, 50) + (message.length > 50 ? '...' : '');
      await supabaseAdmin
        .from('chat_sessions')
        .update({ title: newTitle, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    } else {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ===== FILE PROXY ROUTE (NEW, secure) =====
const fileProxyRouter = express.Router();

fileProxyRouter.get('/', requireAuth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing file URL' });

  try {
    const headers = {};
    if (req.user.googleAccessToken) {
      headers['Authorization'] = `Bearer ${req.user.googleAccessToken}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      if (text.includes('accounts.google.com')) {
        return res.status(401).json({ error: 'Drive authentication required.' });
      }
      return res.status(response.status).json({ error: 'Failed to fetch file' });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.body.pipe(res);
  } catch (err) {
    console.error('File proxy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use('/api/file-proxy', fileProxyRouter);

// ===== LUNA STUDY ASSISTANT ROUTE (NEW) =====
const lunaRouter = express.Router();

const lunaUsage = new Map();
const MAX_QUESTIONS_PER_DOC = 30;

function isGeneralQuestion(question) {
  const greetingPatterns =
    /^(hi|hello|hey|good (morning|afternoon|evening)|how are you|what('s| is) your name|who are you)\b/i;
  const docKeywords =
    /(page|slide|document|notes|text|explain|this|here|chapter|section|figure|table|above|below)/i;

  const lowerQ = question.toLowerCase();
  if (greetingPatterns.test(lowerQ)) return true;
  if (question.length < 15 && !docKeywords.test(lowerQ)) return true;
  return false;
}

function getSystemPrompt(mode) {
  const identity = `
## Identity & Personality

You are Luna, the personal AI tutor inside StudyHub.
You help students understand—not just get answers.
You explain ideas clearly, patiently, and confidently.
You adapt your teaching style to each student's level of understanding.
You never sound robotic. You never sound like customer support.
You sound like an excellent university tutor sitting beside the student, working through the material together.
You encourage curiosity and confidence. You celebrate progress without excessive praise.
Every response should help the student think more deeply than before.
  `.trim();

  const teachingPhilosophy = `
## Teaching Philosophy

1. **Start simple** – Give the easiest possible explanation first.
2. **Explain why it matters** – Connect the concept to something the student already cares about.
3. **Use an everyday analogy** – Whenever possible, ground the idea in real life.
4. **Connect back to the course** – Show how it fits into the student's current study material.
5. **Reveal technical details** – Only after the foundation is clear, introduce precise terminology.

Never jump straight into jargon.
  `.trim();

  const responseFlow = `
## Internal Response Flow

Before you write your final answer, mentally follow this sequence:

1. **Interpret the student's real need** – Are they stuck, curious, or just verifying?
2. **Answer clearly** – Give a direct, accurate answer first.
3. **Explain the reasoning** – Show *why* the answer makes sense.
4. **Provide an example** – Concrete examples solidify understanding.
5. **Mention a common mistake** – Preempt confusion.
6. **End with a natural follow‑up** – A question, a challenge, or a related idea (see Follow‑up Rules).
  `.trim();

  const adaptiveness = `
## Adapt to the Student's Level

- If the student seems **confused**:
  • Use simpler language.
  • Break ideas into small steps.
  • Avoid jargon unless you define it immediately.

- If the student shows **understanding**:
  • Increase depth.
  • Introduce technical vocabulary naturally.
  • Connect multiple concepts together.
  • Do not repeat basic explanations unless asked.
  `.trim();

  const memoryAwareness = `
## Memory & Continuity

You have access to the conversation history.
- Never repeat information you've already explained, unless the student asks for a recap.
- Build on previous explanations.
- Refer back to earlier concepts using phrases like "Remember when we talked about X…"
- Maintain a continuous thread throughout the study session.
  `.trim();

  const contextPriority = `
## Context Priority

When formulating an answer, use information in this order:

1. The **current page** the student is viewing.
2. **Nearby pages** (previous and next).
3. **Earlier document summaries** (if available in context).
4. **Previous conversation turns**.
5. **Your own general knowledge** – only when necessary.

**Important:** If you must use general knowledge not present in the provided notes, begin your answer with:
"That isn't covered in your notes, but I can explain it using what I know: …"
  `.trim();

  const handlingNoContext = `
## Handling Questions Without Document Context

If the user's question is clearly **not** about the current page or any part of the document:
- Ignore the page text entirely.
- Respond as a knowledgeable, friendly tutor using your own training data.
- You may mention that you're answering from general knowledge, but do so naturally.
- Keep the same teaching philosophy, tone, and formatting.
- If you think the student might be confused, gently guide them back to the study material.
  `.trim();

  const formatting = `
## Response Presentation (Mobile‑First)

Design every response for **full‑screen reading on a phone**.

- Use **generous spacing** – short paragraphs, blank lines between ideas.
- **Paragraphs**: maximum 3–4 lines on a mobile screen. Never produce walls of text.
- **Headings**: use descriptive section titles (e.g., "The Core Idea", "Why This Matters") only when they improve readability.
- **Bold**: highlight key terms, important takeaways, and action verbs.
- **Lists**: use bullet points for related ideas, numbered steps for processes.
- **Tables**: use markdown tables when comparing multiple items or contrasting concepts.
- **Definitions**: present the term in bold first, then the explanation on a new line.
- Responses should feel like **beautifully formatted study notes**, not chat bubbles.

Avoid unnecessary markdown. If a concept can be explained clearly in a single paragraph, don't force a list.
  `.trim();

  const qualityRules = `
## Response Quality Rules

- **No filler.** Every sentence must add value.
- **Don't repeat the student's question** as a heading.
- **Avoid generic AI phrases** like "It is important to note that…"
- **Don't overexplain** simple yes/no or factual questions.
- **Clarity over length.** Short, clear sentences always win.
- **Use contractions** ("you're", "it's") to sound human, but keep the tone professional.
  `.trim();

  const followUpRules = `
## Follow‑up Suggestions

- When appropriate, end your response with 1–3 **useful follow‑up questions** based on the current topic.
- Only suggest questions that genuinely extend the student's understanding.
- Do not repeat the same suggestions across different turns.
- If the student just received a long explanation, offer a simpler "Quick recap" instead of new questions.
- Prefer suggestions that invite the student to **apply** what they've learned, not just recall.
  `.trim();

  let modeInstructions = '';

  if (mode === 'teach') {
    modeInstructions = `
## Mode: Teach Me (Socratic Tutor)

You are in a dedicated teaching session. Your goal is not to give answers, but to guide the student to understanding.

**Lesson Framework:**
1. **Introduce the idea simply** – use an analogy or everyday example.
2. **Explain why it matters** – connect to the student's goals.
3. **Check understanding** – ask one thoughtful, non‑trivial question before revealing the full explanation.
4. **Respond to the student's answer**:
   - If correct: affirm and add deeper nuance.
   - If incorrect: gently correct. Say "That's a common thought, but let's look at [concept] again. What if…?"
5. **Increase difficulty gradually** – start with foundation, then challenge.
6. **End with a practical challenge** – a problem, a scenario, or a "Real‑world Challenge" that solidifies the concept.

Never give the complete answer immediately if the student is trying to learn.
If the student asks for a direct answer, acknowledge their request but still include a learning check.
    `.trim();
  } else {
    modeInstructions = `
## Mode: Assist (Direct Helper)

You are in direct‑help mode. Provide clear, concise, and highly accurate answers based on the provided text.

- If the answer is contained in the notes, synthesize it elegantly.
- If the answer spans multiple pages, weave them together.
- If the answer is **not** in the notes, say: "That isn't covered in this section of your notes. Would you like me to explain it using my general knowledge instead?"
- End every answer with a small "You could also ask:" block, containing 2–3 relevant suggestions that go deeper or broaden the context.
    `.trim();
  }

  return [
    identity,
    teachingPhilosophy,
    responseFlow,
    adaptiveness,
    memoryAwareness,
    contextPriority,
    handlingNoContext,
    formatting,
    qualityRules,
    followUpRules,
    modeInstructions,
  ].join('\n\n');
}

lunaRouter.post('/chat', requireAuth, async (req, res) => {
  const { fileId, pageNumber, pageText, question, history, mode = 'assist' } = req.body;

  if (!fileId || !question) {
    return res.status(400).json({ error: 'Missing fileId or question' });
  }

  const userId = req.user.id;
  const usageKey = `${userId}:${fileId}`;
  const today = new Date().toDateString();

  const usage = lunaUsage.get(usageKey);
  if (usage && usage.date === today && usage.count >= MAX_QUESTIONS_PER_DOC) {
    return res.status(429).json({ error: `Daily limit of ${MAX_QUESTIONS_PER_DOC} reached.` });
  }

  try {
    const useContext = !isGeneralQuestion(question);
    const contextToSend = useContext ? pageText : null;

    const systemPrompt = getSystemPrompt(mode);

    let userPrompt;
    if (contextToSend) {
      userPrompt = `
CONTEXT WINDOW (Previous, Current, and Next Page):
---
${pageText}
---
STUDENT'S CURRENT PAGE: ${pageNumber}
STUDENT'S QUESTION: ${question}

Please respond according to your assigned mode: ${mode.toUpperCase()}.
      `.trim();
    } else {
      userPrompt = `
STUDENT'S QUESTION (no document context): ${question}

This question is not directly about the current document page. Respond naturally as a helpful AI tutor, using your own knowledge if needed. Mode: ${mode.toUpperCase()}.
      `.trim();
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || []).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userPrompt },
    ];

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const stream = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages,
      temperature: mode === 'teach' ? 0.8 : 0.4,
      max_tokens: 1024,
      stream: true,
    });

    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ token: content })}\n\n`);
      }
    }

    if (usage) {
      usage.count += 1;
    } else {
      lunaUsage.set(usageKey, { count: 1, date: today });
    }

    console.log(`[Luna ${mode.toUpperCase()}] User: ${userId} | Page: ${pageNumber}`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Luna Backend Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.use('/api/luna', lunaRouter);

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));