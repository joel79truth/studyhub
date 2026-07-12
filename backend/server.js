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

dotenv.config();

/* ===== INITIALISATION ===== */

// Firebase Admin SDK – for FCM push notifications
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

// Auth middleware (Supabase)
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

let sseClients = [];

/* ===== ROUTES ===== */

app.get("/", (req, res) => res.send("Server is running"));

// Programs list (public)
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

// ===== UPLOAD (FAST & CORRECT) =====
app.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { program, semester, subject } = req.body;
    const file = req.file;
    if (!program || !semester || !subject || !file) {
      return res.status(400).json({ message: "Missing fields or file" });
    }

    // Choose storage: Google Drive for large files, Supabase for small
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

    // Insert metadata into `notes` table
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

    // Push notifications (FCM)
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

// Metadata endpoint (using uploader_uid)
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

// ************** NEW ROUTE: App Update Checker **************
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

// Submit a request (for missing notes)
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
    // Send notification to program subscribers
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

// Other routes (requests, chat, events, etc.)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));