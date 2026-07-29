

const Groq = require('groq-sdk');

// server.js – Full Multi‑Modal Pipeline with Math/Chem/Diagram Extraction + AI Grading
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
const { v4: uuidv4 } = require("uuid");
const admin = require("firebase-admin");
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
const { Readable } = require("stream");
const path = require("path");
const http = require("http");
const https = require("https");
const JSON5 = require("json5");
const sharp = require("sharp");

/* ======== Gemini AI ======== */
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });  
/* ===== INITIALISATION ===== */

// Firebase Admin SDK
if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_BASE64");
}
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString()
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Supabase clients
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase credentials");
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
  throw new Error("Missing Google OAuth credentials");
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
  version: "v3",
  auth: oauth2Client,
  httpAgent: httpsAgent,
});

const upload = multer({ storage: multer.memoryStorage() });

/* ======== Gemini initialisation ======== */
if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️  GEMINI_API_KEY not set. Exam Trainer features will fail.");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "dummy-key");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ===== HELPERS ===== */

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
      console.log(`Drive upload succeeded on attempt ${attempt}`);
      return driveRes;
    } catch (err) {
      console.error(`Drive attempt ${attempt} failed:`, err.message);
      if (attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Auth middleware
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error('Unauthorized');
    req.user = user;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({ message: "Unauthorized" });
  }
}

// Spaced repetition helper (UPDATED: stores course)
async function updateTopicMastery(userId, topic, correct, course) {
  const { data: current } = await supabaseAdmin
    .from("user_weak_topics")
    .select("mastery")
    .eq("user_id", userId)
    .eq("topic", topic)
    .maybeSingle();

  const oldMastery = current ? current.mastery : 0.5;
  const newMastery = correct
    ? Math.min(1.0, oldMastery + 0.05)
    : Math.max(0.0, oldMastery - 0.03);

  await supabaseAdmin.from("user_weak_topics").upsert({
    user_id: userId,
    topic,
    course: course || null,
    mastery: newMastery,
    last_updated: new Date().toISOString(),
  }, { onConflict: "user_id,topic" });
}

// AI grading for structured answers
async function gradeStructuredAnswer(questionText, correctAnswer, userAnswer) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
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
    text = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON5.parse(text);
    } catch (parseErr) {
      console.error("JSON5 parse error in gradeStructuredAnswer:", parseErr.message);
      console.error("Raw text:", text);
      return {
        correct: false,
        explanation: "We could not grade your answer due to a technical issue. Please try again."
      };
    }

    return {
      correct: parsed.correct,
      explanation: parsed.explanation || (parsed.correct ? "Well done!" : "Not quite. The correct answer is: " + correctAnswer)
    };
  } catch (err) {
    console.error("Error in gradeStructuredAnswer:", err);
    return {
      correct: false,
      explanation: "An error occurred while grading. Please try again."
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
      .from(process.env.SUPABASE_BUCKET || "files")
      .upload(filePath, croppedBuffer, { contentType: 'image/png', upsert: true });

    if (error) throw error;

    const publicUrl = supabaseAdmin.storage
      .from(process.env.SUPABASE_BUCKET || "files")
      .getPublicUrl(filePath).data.publicUrl;

    return publicUrl;
  } catch (err) {
    console.error("Diagram cropping/upload error:", err);
    return null;
  }
}

let sseClients = [];

/* ===== ROUTES ===== */

app.get("/", (req, res) => res.send("Server is running"));

// Programs list
app.get("/api/programs", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("programs")
      .select("name")
      .order("name");
    if (error) throw error;
    res.json({ programs: data.map(p => p.name) });
  } catch (err) {
    console.error("Fetch programs error:", err);
    res.status(500).json({ message: "Failed to load programs" });
  }
});

// Save FCM token
app.post("/save-token", requireAuth, async (req, res) => {
  const { token, program } = req.body;
  if (!token) return res.status(400).json({ message: "Missing token" });
  try {
    const { error } = await supabaseAdmin
      .from("fcm_tokens")
      .upsert(
        { token, uid: req.user.id, program: program || null },
        { onConflict: "token" }
      );
    if (error) throw error;
    res.json({ message: "Token stored", uid: req.user.id });
  } catch (err) {
    console.error("Error saving token:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// Upload notes
app.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { program, semester, subject } = req.body;
    const file = req.file;
    if (!program || !semester || !subject || !file) {
      return res.status(400).json({ message: "Missing fields or file" });
    }

    const USE_GDRIVE = file.size > 5 * 1024 * 1024;
    const id = uuidv4();
    const safeName = file.originalname.replace(/\s+/g, "_");
    const filePath = `${program}/${semester}/${subject}/${Date.now()}-${safeName}`;
    let storage_type, storage_ref, publicUrl;

    if (USE_GDRIVE) {
      const driveRes = await uploadToDriveWithRetry(file);
      storage_type = "gdrive";
      storage_ref = driveRes.data.id;
      publicUrl = `/api/drive/${storage_ref}`;
    } else {
      const { error } = await supabaseAdmin.storage
        .from(process.env.SUPABASE_BUCKET || "files")
        .upload(filePath, file.buffer, { contentType: file.mimetype });
      if (error) throw error;
      storage_type = "supabase";
      storage_ref = filePath;
      publicUrl = supabaseAdmin.storage
        .from(process.env.SUPABASE_BUCKET || "files")
        .getPublicUrl(filePath).data.publicUrl;
    }

    const { error: dbError } = await supabaseAdmin.from("notes").insert([
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
      .from("fcm_tokens")
      .select("token");
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
        if (!r.success && (r.error?.code?.includes("registration-token-not-registered") || r.error?.code?.includes("invalid-registration-token"))) {
          invalidTokens.push(tokenList[i]);
        }
      });
      if (invalidTokens.length) {
        await supabaseAdmin.from("fcm_tokens").delete().in("token", invalidTokens);
      }
    }

    res.json({ message: "Upload successful", url: publicUrl });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "Upload failed", error: err.message });
  }
});

// Google Drive proxy
app.get("/api/drive/:fileId", async (req, res) => {
  try {
    const driveRes = await drive.files.get(
      { fileId: req.params.fileId, alt: "media" },
      { responseType: "stream" }
    );
    driveRes.data.on("error", (streamErr) => {
      console.error("Drive stream error:", streamErr);
      if (!res.headersSent) res.status(500).send("Stream error");
    });
    driveRes.data.pipe(res);
  } catch (err) {
    console.error("Drive proxy error:", err);
    res.status(404).send("File not found");
  }
});

// Metadata endpoint
app.get("/api/metadata", async (req, res) => {
  try {
    const { uid, program } = req.query;
    let query = supabase.from("notes").select("*").order("uploaded_at", { ascending: false });
    if (uid) query = query.eq("uploader_uid", uid);
    if (program) query = query.eq("program", program);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Metadata fetch error:", err);
    res.status(500).json({ message: "Fetch failed" });
  }
});

// App Update Checker
app.get("/api/update", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("app_updates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (error || !data) {
      return res.status(500).json({ error: "No version data found" });
    }
    res.json({
      version: data.version,
      forceUpdate: data.force_update,
      title: data.title,
      message: data.message,
      apkUrl: data.apk_url,
    });
  } catch (err) {
    console.error("Update fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Submit a request
app.post("/submit-request", async (req, res) => {
  try {
    const { topic, course, program, semester, notes, email } = req.body;
    if (!topic || !course || !program || !semester) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const { error } = await supabaseAdmin.from("requests").insert([
      {
        topic,
        course,
        program,
        semester: String(semester),
        notes: notes || "",
        email: email || "",
        created_at: new Date().toISOString(),
      },
    ]);
    if (error) throw error;
    sendNotificationToProgram(program, { topic, course, semester }).catch(console.error);
    res.json({ message: "Request submitted successfully" });
  } catch (err) {
    console.error("Request error:", err);
    res.status(500).json({ message: "Failed to submit request" });
  }
});

async function sendNotificationToProgram(program, { topic, course, semester }) {
  const { data: tokens, error } = await supabaseAdmin
    .from("fcm_tokens")
    .select("token")
    .eq("program", program);
  if (error || !tokens?.length) return;
  const tokenList = tokens.map(t => t.token);
  const message = {
    tokens: tokenList,
    notification: {
      title: `📝 New Request: ${topic}`,
      body: `${course} - ${program} Sem ${semester}`,
    },
    data: {
      type: "request",
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
    if (!r.success && (r.error?.code?.includes("registration-token-not-registered") || r.error?.code?.includes("invalid-registration-token"))) {
      invalid.push(tokenList[i]);
    }
  });
  if (invalid.length) await supabaseAdmin.from("fcm_tokens").delete().in("token", invalid);
}

app.get("/api/requests", async (req, res) => {
  try {
    const { data, error } = await supabase.from("requests").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ requests: data });
  } catch (err) {
    res.status(500).json({ requests: [] });
  }
});

app.delete("/api/requests/:id", async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from("requests").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Request deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete request" });
  }
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  sseClients.push(res);
  req.on("close", () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

app.post("/chat-message", async (req, res) => {
  const { sender, program, text } = req.body;
  if (!sender || !program || !text) return res.status(400).json({ message: "Missing fields" });
  const newMessage = { sender, program, text, timestamp: new Date().toISOString() };
  const { error } = await supabaseAdmin.from("messages").insert([newMessage]);
  if (error) return res.status(500).json({ message: "Failed to save message" });
  sseClients.forEach(client => client.write(`data: ${JSON.stringify(newMessage)}\n\n`));
  res.json({ message: "Message sent", newMessage });
});

app.use("/files", express.static(path.join(__dirname, "public/files")));

app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ reply: "No message provided." });
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a helpful AI tutor..." }, { role: "user", content: message }],
        temperature: 0.7,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message);
    res.json({ reply: data.choices[0].message.content });
  } catch (err) {
    console.error("GPT error:", err);
    res.status(500).json({ reply: "AI service error" });
  }
});

/* ======== EXAM TRAINER ROUTES ======== */

// Upload past paper
app.post("/api/exam/upload-past-paper", requireAuth, upload.single("paper"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const imageBase64 = req.file.buffer.toString("base64");
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

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
    text = text.replace(/```json|```/g, "").trim();

    let questions;
    try {
      questions = JSON5.parse(text);
    } catch (parseErr) {
      console.error("JSON5 parse error in past-paper upload:", parseErr.message);
      const start = Math.max(0, (parseErr.position || 0) - 80);
      const end = Math.min(text.length, (parseErr.position || 0) + 80);
      console.error("Offending snippet:", text.substring(start, end));
      return res.status(500).json({ error: "Invalid JSON from AI: " + parseErr.message });
    }

    const validQuestions = questions.filter(q => q.question && q.question.trim().length > 0);
    if (validQuestions.length === 0) {
      return res.status(400).json({ error: "No valid questions extracted." });
    }

    const paperId = uuidv4();
    const inserts = [];
    const diagramTasks = [];

    for (let idx = 0; idx < validQuestions.length; idx++) {
      const q = validQuestions[idx];
      const base = {
        course: q.course || "Unknown",
        topic: q.topic || "Unknown",
        question: q.question.trim(),
        question_type: q.question_type || "structured",
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

      if (q.question_type === "mcq") {
        inserts.push({
          ...base,
          option_a: q.option_a || "",
          option_b: q.option_b || "",
          option_c: q.option_c || "",
          option_d: q.option_d || "",
          answer: q.answer || "",
        });
      } else {
        inserts.push({
          ...base,
          option_a: "",
          option_b: "",
          option_c: "",
          option_d: "",
          answer: q.answer || "",
        });

        if (q.question_type === "structured" && q.mcq_variant && q.mcq_variant.question) {
          const variant = q.mcq_variant;
          inserts.push({
            ...base,
            question_type: "mcq",
            question: variant.question.trim(),
            option_a: variant.option_a || "",
            option_b: variant.option_b || "",
            option_c: variant.option_c || "",
            option_d: variant.option_d || "",
            answer: variant.answer || "",
          });
        }
      }

      if (q.has_diagram && q.diagram_coordinates) {
        diagramTasks.push({
          coordinates: q.diagram_coordinates,
          questionIdx: idx,
        });
      }
    }

    const { data: mainData, error: mainError } = await supabaseAdmin
      .from("past_papers")
      .insert(inserts)
      .select();
    if (mainError) throw mainError;

    for (const task of diagramTasks) {
      const row = mainData[task.questionIdx];
      if (row) {
        const url = await cropAndUploadDiagram(
          req.file.buffer,
          task.coordinates,
          req.file.mimetype,
          row.id
        );
        if (url) {
          await supabaseAdmin.from("past_papers").update({ image_url: url }).eq("id", row.id);
        }
      }
    }

    res.json({ success: true, extracted: mainData.length, paper_id: paperId });
  } catch (err) {
    console.error("Past paper extraction error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Generate similar questions
app.post("/api/exam/generate-similar", requireAuth, async (req, res) => {
  const { pastQuestionId } = req.body;
  try {
    const { data: original, error } = await supabaseAdmin
      .from("past_papers")
      .select("*")
      .eq("id", pastQuestionId)
      .single();
    if (error || !original) return res.status(404).json({ error: "Past question not found" });

    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    let prompt;
    if (original.question_type === "mcq") {
      prompt = `You are an exam question generator for LUANAR. Take this past MCQ and create 5 new similar MCQs on the same topic. Return a JSON array of objects with fields: question, option_a, option_b, option_c, option_d, answer (correct option letter). Original question: "${original.question}" Options: A) ${original.option_a} B) ${original.option_b} C) ${original.option_c} D) ${original.option_d} Answer: ${original.answer} Topic: ${original.topic}`;
    } else {
      prompt = `You are an exam question generator for LUANAR. Take this past structured question and create 5 new similar structured questions on the same topic. Return a JSON array with fields: question, answer (model answer). Original question: "${original.question}" Model answer: "${original.answer}" Topic: ${original.topic}`;
    }

    const result = await model.generateContent(prompt);
    let text = result.response.text().replace(/```json|```/g, "").trim();

    let generated;
    try {
      generated = JSON5.parse(text);
    } catch (parseErr) {
      console.error("JSON5 parse error in generate-similar:", parseErr.message);
      return res.status(500).json({ error: "Invalid JSON from AI: " + parseErr.message });
    }

    const inserts = generated.map(q => ({
      source_past_paper_id: original.id,
      question: q.question,
      option_a: original.question_type === "mcq" ? (q.option_a || "") : "",
      option_b: original.question_type === "mcq" ? (q.option_b || "") : "",
      option_c: original.question_type === "mcq" ? (q.option_c || "") : "",
      option_d: original.question_type === "mcq" ? (q.option_d || "") : "",
      answer: q.answer,
      course: original.course,
      topic: original.topic,
      question_type: original.question_type,
      difficulty_stage: "learning"
    }));

    const { data, error: insertErr } = await supabaseAdmin.from("generated_questions").insert(inserts).select();
    if (insertErr) throw insertErr;

    res.json({ success: true, count: data.length });
  } catch (err) {
    console.error("Generate similar error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Adaptive quiz (FIXED: course name lookup)
app.get("/api/exam/quiz", requireAuth, async (req, res) => {
  const { mode = "learning", count = 10, preferred, courseId } = req.query;
  const userId = req.user.id;

  try {
    const now = new Date().toISOString();

    // Look up course name from ID if provided
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

    const weakTopicsResp = await supabaseAdmin.from("user_weak_topics").select("*").eq("user_id", userId);
    const weakTopics = weakTopicsResp.data || [];

    async function fetchQuestions(table, typeFilter = null, limitCount = 10) {
      let query = supabaseAdmin.from(table).select("*");
      if (courseName) {
        query = query.eq("course", courseName);
      }
      if (typeFilter) {
        query = query.eq("question_type", typeFilter);
      }
      const { data: all } = await query.limit(limitCount * 2);
      return all || [];
    }

    let questionsPool = [];

    if (mode === "exam") {
      questionsPool = await fetchQuestions("past_papers", null, count);
    } else if (mode === "auto") {
      const mix = { mcq: Math.ceil(count * 0.4), structured: Math.ceil(count * 0.3), diagram: Math.ceil(count * 0.1) };
      let fetched = [];
      for (const [type, num] of Object.entries(mix)) {
        if (num === 0) continue;
        let typeQuestions = await fetchQuestions("past_papers", type, num);
        fetched.push(...typeQuestions);
      }
      questionsPool = fetched;
    } else {
      const typeFilter = (preferred && preferred !== 'all') ? preferred : null;
      questionsPool = await fetchQuestions("past_papers", typeFilter, count);
    }

    const { data: seenProgress } = await supabaseAdmin
      .from("user_progress")
      .select("question_id, question_type")
      .eq("user_id", userId);
    const seenIds = seenProgress.map(p => p.question_id);
    const dueProgress = await supabaseAdmin
      .from("user_progress")
      .select("question_id")
      .eq("user_id", userId)
      .lte("next_review", now);
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
    console.error("Get quiz error:", err);
    res.status(500).json({ error: err.message });
  }
});

// AI Grading endpoint
app.post("/api/exam/grade", requireAuth, async (req, res) => {
  const { questionText, correctAnswer, userAnswer } = req.body;
  if (!questionText || !correctAnswer || !userAnswer) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  try {
    const grading = await gradeStructuredAnswer(questionText, correctAnswer, userAnswer);
    res.json(grading);
  } catch (err) {
    console.error("Grade error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Submit answer (with spaced repetition)
app.post("/api/exam/submit-answer", requireAuth, async (req, res) => {
  const { questionId, questionType, correct, topic, userAnswer, questionText, correctAnswer, course } = req.body;
  const userId = req.user.id;

  try {
    const now = new Date();
    let isCorrect = correct;

    if (questionType !== "mcq" && userAnswer) {
      const grading = await gradeStructuredAnswer(questionText, correctAnswer, userAnswer);
      isCorrect = grading.correct;
      res.locals.explanation = grading.explanation;
    }

    const { data: progress } = await supabaseAdmin
      .from("user_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("question_id", questionId)
      .eq("question_type", questionType)
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
        .from("user_progress")
        .update({
          repetitions,
          ease_factor,
          interval_days,
          next_review: next_review.toISOString(),
          last_reviewed: now.toISOString(),
          correct_count: progress.correct_count + (isCorrect ? 1 : 0),
          incorrect_count: progress.incorrect_count + (isCorrect ? 0 : 1),
        })
        .eq("user_id", userId)
        .eq("question_id", questionId)
        .eq("question_type", questionType);
    } else {
      repetitions = isCorrect ? 1 : 0;
      interval_days = isCorrect ? 1 : 0;
      ease_factor = 2.5;
      next_review = isCorrect
        ? new Date(now.getTime() + interval_days * 24 * 60 * 60 * 1000)
        : now;

      await supabaseAdmin.from("user_progress").insert({
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
    console.error("Submit answer error:", err);
    res.status(500).json({ error: err.message });
  }
});

// AI explanation
app.post("/api/exam/explain", requireAuth, async (req, res) => {
  const { question, correctAnswer, userAnswer } = req.body;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
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
    console.error("Explain error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Stats endpoint (with improved readiness formula)
app.get("/api/exam/stats", requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    const { count: totalAttempted } = await supabaseAdmin
      .from("user_progress")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    const { data: weakTopics } = await supabaseAdmin
      .from("user_weak_topics")
      .select("*")
      .eq("user_id", userId);

    const avgMastery = weakTopics.length
      ? weakTopics.reduce((sum, w) => sum + w.mastery, 0) / weakTopics.length
      : 0.5;

    // Logistic saturation: readiness grows slowly with attempts
    const attemptsFactor = 1 - Math.exp(-(totalAttempted || 0) / 50);
    const rawScore = avgMastery * attemptsFactor;
    const confidence = Math.min(100, Math.round(rawScore * 100));

    const now = new Date().toISOString();
    const { count: dueCount } = await supabaseAdmin
      .from("user_progress")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .lte("next_review", now);

    res.json({
      totalAttempted: totalAttempted || 0,
      weakTopics: weakTopics.map(w => ({ topic: w.topic, mastery: w.mastery, course: w.course })),
      confidence,
      examReadiness:
        confidence >= 80
          ? "Ready for Finals"
          : confidence >= 60
          ? "Getting There"
          : "Needs Work",
      dueToday: dueCount || 0,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ======== Drawing Upload ======== */
const uploadDrawing = multer({ storage: multer.memoryStorage() });

app.post("/api/upload-drawing", requireAuth, uploadDrawing.single('image'), async (req, res) => {
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






// ===== STUDYBOT – Gemini‑powered chat =====
app.post("/api/studybot/chat", requireAuth, async (req, res) => {
  const { messages, userName, userSubject } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array required." });
  }

  // Personalised system prompt
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
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Understood! I am StudyBot, ready to help you." }] },
    ...messages.map(m => ({
      role: m.role === "user" ? "user" : "model",
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
  console.error("StudyBot Gemini error:", err);
  res.status(500).json({ error: "AI service error: " + err.message });
}

});
/* ======== END ======== */
// ===== STUDYBOT 2.0 – Course‑aware, streaming chat with session history =====
// ===== STUDYBOT 2.0 – Fast, structured, course‑aware, streaming chat with session history =====

const rateLimit = require('express-rate-limit');

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

// ----- Robust context fetch -----
async function getStudentContext(userId) {
  const cached = getCachedContext(userId);
  if (cached) return cached;

  // 1. Profile – now includes streak, quiz stats, daily_counts
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select(
      'program, name, semester, year_of_study, streak, last_active, quizzes_completed, accuracy_rate, total_questions, total_correct, daily_counts, badges'
    )
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) console.error('Profile fetch error:', profileErr);

  // 2. Courses
  let courses = [];
  try {
    const { data: coursesData } = await supabaseAdmin
      .from('courses')
      .select('course_name')
      .eq('user_id', userId);
    courses = (coursesData || []).map(c => c.course_name);
  } catch (e) {}

  // 3. Weaknesses (already exists)
  let weaknesses = [];
  try {
    const { data: wData } = await supabaseAdmin
      .from('user_weak_topics')
      .select('topic, mastery, course')
      .eq('user_id', userId)
      .order('mastery', { ascending: true })
      .limit(5); // weakest first
    weaknesses = (wData || []).map(w => ({
      topic: w.topic,
      mastery: w.mastery,
      course: w.course || '',
    }));
  } catch (e) {}

  // 4. Strengths – derive from weak topics with mastery > 0.8 (or you can create a new table)
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

  // 5. Recent activity – from quiz_sessions (last 5) + today’s count from daily_counts
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

    // Bonus: daily_counts JSONB might have today's count already
    if (profile?.daily_counts) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const todayCount = profile.daily_counts[today] || 0;
      if (todayCount > 0) {
        recentActivity += ` Today's question count: ${todayCount}.`;
      }
    }
  } catch (e) {}

  // 6. Upcoming exams – no table, skip. (If you add later, adjust.)
  const upcomingExams = []; // placeholder

  // 7. Study streak (from profile)
  const studyStreak = profile?.streak || 0;

  // 8. Preferred explanation style – not stored, default to 'standard'
  const preferredExplanationStyle = 'standard'; // Could be added to profiles later

  // 9. Past paper summaries (keep as is, or reduce)
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
    paperSummaries,     // still available but consider removing for token savings
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

// ----- Sanitise dynamic text to prevent prompt injection -----
function safe(str) {
  if (!str) return '';
  return str.replace(/\n/g, ' ').replace(/\r/g, '');
}

// ----- Build the system instruction with formatting guidance -----
function buildSystemPrompt(context) {
  const {
    name, program, semester, yearOfStudy, courses, weaknesses, strengths,
    recentActivity, upcomingExams, studyStreak, preferredExplanationStyle,
    quizzesCompleted, accuracyRate, totalQuestions, totalCorrect, badges,
    paperSummaries
  } = context;

  const s = (str) => (str || '').replace(/\n/g, ' ').replace(/\r/g, '');

  const profileLines = [];
  if (name) profileLines.push(`Name: ${s(name)}`);
  if (program) profileLines.push(`Program: ${s(program)}`);
  if (semester) profileLines.push(`Semester: ${semester}`);
  if (yearOfStudy) profileLines.push(`Year of Study: ${yearOfStudy}`);
  if (courses.length) profileLines.push(`Current Courses:\n${courses.map(c => `- ${s(c)}`).join('\n')}`);
  if (weaknesses.length) {
    const weakList = weaknesses.map(w => `- ${s(w.topic)} (mastery: ${Math.round(w.mastery*100)}%)`).join('\n');
    profileLines.push(`Weak Areas:\n${weakList}`);
  }
  if (strengths.length) profileLines.push(`Strengths:\n${strengths.map(st => `- ${s(st)}`).join('\n')}`);
  if (recentActivity) profileLines.push(`Recent Activity: ${recentActivity}`);
  if (studyStreak) profileLines.push(`Study Streak: ${studyStreak} days`);
  if (upcomingExams.length) {
    const examLines = upcomingExams.map(e => `- ${s(e.course)} in ${e.daysLeft} days`).join('\n');
    profileLines.push(`Upcoming Exams:\n${examLines}`);
  }
  if (badges && badges.length) profileLines.push(`Badges: ${badges.join(', ')}`);
  if (accuracyRate) profileLines.push(`Quiz Accuracy: ${accuracyRate}% (${totalCorrect}/${totalQuestions} correct)`);
  if (preferredExplanationStyle && preferredExplanationStyle !== 'standard') {
    profileLines.push(`Preferred Explanation Style: ${s(preferredExplanationStyle)}`);
  }

  const profileBlock = profileLines.join('\n');

  const prompt = `You are Luna, the personal AI study mentor inside StudyHub.

**Your Personality:**
- Warm, patient, and genuinely invested in the student's success.
- Speak naturally and confidently—like a friendly senior tutor, not customer support.
- Use a conversational tone. Avoid robotic or encyclopaedic language.

**Your Core Behavior:**
- Answer the question the student actually asked.
- Explain concepts at the level the student's question suggests.
- Start simple and expand only if the student asks for more detail.
- Never try to teach an entire chapter in one response. Treat learning as a conversation.
- Use progressive disclosure: give the minimum useful answer first, then offer to go deeper.

-----

**Student Context (provided automatically):**
${profileBlock}

${paperSummaries ? `Relevant past paper context for courses:\n${paperSummaries}` : ''}
-----

**RESPONSE FORMAT — follow these exactly:**

**Structure your response in this order:**
1. **Direct answer** — 1–3 sentences that answer exactly what was asked.
2. **Brief explanation** — only if needed. Keep it tight.
3. **Example** — one concrete example, only when it genuinely aids understanding.
4. **Next step** — one optional follow-up question or suggestion, only when it feels natural.

Never pad. Never summarise what you just said. Never list things that belong in prose.

---

**Length by question type:**

| Type | Target |
|---|---|
| Definition / quick check | 20–80 words |
| Normal question | 80–180 words |
| "Explain" / "How does…" / multi-step | 180–350 words |
| Detailed notes / full lesson / revision (explicit request only) | 350+ words |

---

**Formatting rules:**

- **Short answers (< 150 words):** plain paragraphs only — no headings, no bullet lists.
- **Medium answers (150–350 words):** short paragraphs; bullets only where a list genuinely beats prose.
- **Long answers (350+ words):** use \`##\` headings to chunk; numbered steps for procedures; bullets for true lists.
- **Code:** triple backticks with language name.
- **Math:** \`\\(...\\)\` inline · \`$$...$$\` for block equations.
- Never cut off mid-sentence. Wrap up gracefully if truncated.

**Avoid these formatting anti-patterns:**
- ❌ Opening with "Sure!" / "Great question!" / "Of course!"
- ❌ Bullet-ising everything — prose is often clearer.
- ❌ Restating the question before answering it.
- ❌ Closing every message with a question.
- ❌ Using bold text inside sentences just for decoration.

---

**Active Learning (gentle):**
When natural — not forced — include a short recall question, a micro-quiz prompt, or a flashcard suggestion.

**Handling Emotion:**
If the student expresses frustration or anxiety, acknowledge their feelings first. Then offer support. Do not jump straight into explanations.

**Observant, Not Creepy:**
When referencing past activity, phrase it naturally:
- ❌ "I know you love Hydrology."
- ✅ "I noticed you've been spending time on Hydrology recently."

**Personalised Greetings (first message of a session only):**
Open with a warm, specific greeting that mentions the student’s name, program, and at least one course.
For example: *"Welcome back, Joel! I'm Luna, your study mentor for Irrigation Engineering. I see you're studying Hydrology, Irrigation Design, and more – ready to dive in?"*
Always tailor the greeting to the student’s actual profile data.

---

**Reasoning checklist (do this silently before every reply):**
1. What is the student actually asking?
2. Simple or complex request?
3. What is the shortest answer that fully satisfies the question?
4. Does an example genuinely help here?
5. Does this response need a follow-up nudge, or should I just stop?

You are Luna. Now respond to the student.`;

  return prompt;
}
// ============ Routes ============

// GET /api/chat/sessions – list user's sessions
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

// POST /api/chat/sessions – create a new session
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

// GET /api/chat/sessions/:id/messages – load messages for a session
app.get('/api/chat/sessions/:id/messages', requireAuth, async (req, res) => {
  try {
    // Verify ownership
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

// DELETE /api/chat/sessions/:id
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

// Rate limiter for the streaming chat endpoint
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 15,                   // 15 requests per minute per IP (adjust as needed)
  message: { error: 'Too many messages, please slow down.' },
});

// POST /api/chat/sessions/:id/messages – stream a response (fast & structured)
app.post('/api/chat/sessions/:id/messages', requireAuth, chatLimiter, async (req, res) => {
  const { message } = req.body;
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
    // 2. Save user message immediately
    const { error: msgErr } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'user',
        content: message,
      });

    if (msgErr) throw msgErr;

    // 3. Build context & system message (cached)
    const context = await getStudentContext(userId);
    const systemContent = buildSystemPrompt(context);

    // 4. Fetch recent history (last 20 messages)
    const { data: history } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    const MAX_HISTORY = 20;
    const recentHistory = (history || []).slice(-MAX_HISTORY);

    // 5. Prepare messages for Groq (system + history)
    const messages = [
      { role: 'system', content: systemContent },
      ...recentHistory.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    ];

    // 6. Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 7. Stream from Groq (Llama 3.1 70B – fast, high quality)
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

    // 8. Save assistant message
    await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'model',
        content: fullResponse,
      });

    // 9. Update session title
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

// ===== END STUDYBOT 2.0 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));