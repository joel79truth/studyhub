// storageUpload.js
//
// Upload service with TWO supported flows:
//
//   A) Legacy single-shot proxy upload:
//        POST /api/storage/upload   (multipart, file goes through this server)
//      Kept for backwards compatibility / reuse by other upload paths
//      (past papers, drawings, etc.) via uploadFileToStorage().
//
//   B) Direct-to-storage (presigned) upload — this is what Upload.jsx
//      actually calls:
//        POST /api/storage/init-upload   -> returns where to PUT the bytes
//        (client uploads bytes directly to Google Drive or Supabase)
//        POST /api/storage/complete      -> backend records the DB row
//
// Flow B exists so large files never have to be buffered through this
// server (memory pressure, timeouts) and so the client gets real
// upload-progress events (Drive: native XHR progress; Supabase: signed
// upload URL).
//
// Mount it in server.js with:
//   app.use('/api/storage', require('./storageUpload').router);
// and delete the old inline app.post('/upload', ...) block once you've
// switched every frontend caller over.

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const { Readable } = require('stream');
const https = require('https');

// ============================================================================
// CONFIG
// ============================================================================
const GDRIVE_THRESHOLD_BYTES = 5 * 1024 * 1024;   // >5MB -> Google Drive
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;     // hard cap, enforced server-side
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
]);
const ALLOWED_EXTENSIONS = /\.(pdf|pptx)$/i;

// How long an init-upload grant is considered valid before /complete will
// refuse it. Prevents someone calling /complete with a stale/replayed
// init response long after the fact.
const INIT_GRANT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// CLIENTS
// ============================================================================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('storageUpload: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}
if (!process.env.SUPABASE_ANON_KEY) {
  throw new Error('storageUpload: missing SUPABASE_ANON_KEY (needed to verify user tokens)');
}
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

if (!process.env.OAUTH_CLIENT_JSON || !process.env.GOOGLE_REFRESH_TOKEN) {
  throw new Error('storageUpload: missing Google OAuth credentials');
}
const oauthCreds = JSON.parse(process.env.OAUTH_CLIENT_JSON);
const { client_id, client_secret, redirect_uris } = oauthCreds.installed || oauthCreds.web;
const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const httpsAgent = new https.Agent({ keepAlive: true });
const drive = google.drive({ version: 'v3', auth: oauth2Client, httpAgent: httpsAgent });

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'files';
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ============================================================================
// AUTH — Bearer <supabase JWT>
// ============================================================================
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) throw new Error('Unauthorized');
    req.user = user;
    next();
  } catch (err) {
    console.error('[storageUpload] auth error:', err.message);
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// ============================================================================
// SHARED HELPERS
// ============================================================================
function safeFileName(originalname) {
  return originalname.replace(/\s+/g, '_');
}

function buildFilePath({ folderPath, fileName }) {
  const safeName = safeFileName(fileName);
  return folderPath
    ? `${folderPath}/${Date.now()}-${safeName}`
    : `uploads/${Date.now()}-${safeName}`;
}

// Works against either a multer file object ({originalname, mimetype, size})
// or the lightweight {fileName, mimeType, fileSize} shape sent to init-upload.
function validateFile({ originalname, mimetype, size }) {
  if (!ALLOWED_EXTENSIONS.test(originalname) || !ALLOWED_MIME_TYPES.has(mimetype)) {
    const err = new Error('Only PDF or PPTX files are allowed.');
    err.status = 400;
    throw err;
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    const err = new Error('Maximum file size is 50MB.');
    err.status = 400;
    throw err;
  }
}

async function getDriveAccessToken() {
  const { token } = await oauth2Client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Google Drive access token');
  return token;
}

// ============================================================================
// FLOW A — LEGACY SINGLE-SHOT PROXY UPLOAD
// ============================================================================
async function uploadToDriveWithRetry(file, maxRetries = 3, baseDelay = 500) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const bufferStream = new Readable();
      bufferStream.push(file.buffer);
      bufferStream.push(null);
      const driveRes = await drive.files.create({
        requestBody: {
          name: file.originalname,
          parents: GOOGLE_DRIVE_FOLDER_ID ? [GOOGLE_DRIVE_FOLDER_ID] : undefined,
        },
        media: { mimeType: file.mimetype, body: bufferStream },
        timeout: 30000,
      });
      return driveRes;
    } catch (err) {
      console.error(`[storageUpload] Drive attempt ${attempt} failed:`, err.message);
      if (attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Exported so other upload flows (past papers, drawings, etc.) can reuse
// this instead of re-implementing the size-based routing branch.
async function uploadFileToStorage(file, { folderPath } = {}) {
  const filePath = buildFilePath({ folderPath, fileName: file.originalname });
  const useDrive = file.size > GDRIVE_THRESHOLD_BYTES;

  if (useDrive) {
    const driveRes = await uploadToDriveWithRetry(file);
    return {
      storage_type: 'gdrive',
      storage_ref: driveRes.data.id,
      url: `/api/drive/${driveRes.data.id}`, // served by GET /api/drive/:fileId proxy route in server.js
    };
  }

  const { error } = await supabaseAdmin.storage
    .from(SUPABASE_BUCKET)
    .upload(filePath, file.buffer, { contentType: file.mimetype });
  if (error) throw error;

  const publicUrl = supabaseAdmin.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath).data.publicUrl;

  return {
    storage_type: 'supabase',
    storage_ref: filePath,
    url: publicUrl,
  };
}

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

const router = express.Router();

router.post('/upload', requireAuth, multerUpload.single('file'), async (req, res) => {
  try {
    const { program, semester, subject } = req.body;
    const file = req.file;

    if (!program || !semester || !subject || !file) {
      return res.status(400).json({ message: 'Missing fields or file' });
    }

    validateFile(file);

    const folderPath = `${program}/${semester}/${subject}`;
    const { storage_type, storage_ref, url } = await uploadFileToStorage(file, { folderPath });

    const id = uuidv4();
    const { error: dbError } = await supabaseAdmin.from('notes').insert([
      {
        id,
        program,
        semester: String(semester),
        course_name: subject,
        filename: file.originalname,
        filepath: storage_ref,
        url,
        storage_type,
        uploader_uid: req.user.id,
        uploader_email: req.user.email || 'unknown@example.com',
        size: String(file.size),
        uploaded_at: new Date().toISOString(),
      },
    ]);
    if (dbError) throw dbError;

    res.json({ message: 'Upload successful', url, storage_type, id });
  } catch (err) {
    console.error('[storageUpload] upload error:', err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Upload failed' });
  }
});

// ============================================================================
// FLOW B — DIRECT-TO-STORAGE (PRESIGNED) UPLOAD
// ============================================================================
//
// In-memory store of outstanding init-upload grants, keyed by a one-time
// upload id. Each grant records what /complete is allowed to insert, so a
// client can't call /complete with arbitrary metadata that doesn't match
// what it validated at init time.
//
// NOTE: this is process-local. If you run multiple server instances behind
// a load balancer, move this to Redis/Supabase instead, or accept that a
// grant must be completed against the same instance that issued it.
const pendingUploads = new Map();

function cleanupExpiredGrants() {
  const now = Date.now();
  for (const [id, grant] of pendingUploads) {
    if (now - grant.createdAt > INIT_GRANT_TTL_MS) pendingUploads.delete(id);
  }
}

// POST /api/storage/init-upload
// body: { fileName, fileSize, mimeType, program, semester, subject }
// -> { storage_type: 'gdrive', uploadUrl, uploadId }
//    | { storage_type: 'supabase', bucket, path, token, uploadId }
router.post('/init-upload', requireAuth, express.json(), async (req, res) => {
  try {
    cleanupExpiredGrants();

    const { fileName, fileSize, mimeType, program, semester, subject } = req.body || {};
    if (!fileName || !fileSize || !mimeType || !program || !semester || !subject) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const size = Number(fileSize);
    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ message: 'Invalid fileSize' });
    }

    validateFile({ originalname: fileName, mimetype: mimeType, size });

    const folderPath = `${program}/${semester}/${subject}`;
    const uploadId = uuidv4();
    const useDrive = size > GDRIVE_THRESHOLD_BYTES;

    if (useDrive) {
      const accessToken = await getDriveAccessToken();

      const driveInitRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType,
            'X-Upload-Content-Length': String(size),
          },
          body: JSON.stringify({
            name: fileName,
            parents: GOOGLE_DRIVE_FOLDER_ID ? [GOOGLE_DRIVE_FOLDER_ID] : undefined,
          }),
        }
      );

      if (!driveInitRes.ok) {
        const bodyText = await driveInitRes.text().catch(() => '');
        console.error('[storageUpload] Drive resumable init failed:', driveInitRes.status, bodyText);
        return res.status(502).json({ message: 'Could not start Google Drive upload' });
      }

      const uploadUrl = driveInitRes.headers.get('location');
      if (!uploadUrl) {
        return res.status(502).json({ message: 'Drive did not return an upload session URL' });
      }

      pendingUploads.set(uploadId, {
        createdAt: Date.now(),
        storage_type: 'gdrive',
        program,
        semester: String(semester),
        subject,
        filename: fileName,
        size,
        uploaderUid: req.user.id,
        uploaderEmail: req.user.email || 'unknown@example.com',
      });

      return res.json({ storage_type: 'gdrive', uploadUrl, uploadId });
    }

    // Supabase path
    const path = buildFilePath({ folderPath, fileName });
    const { data, error } = await supabaseAdmin.storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(path);
    if (error) throw error;

    pendingUploads.set(uploadId, {
      createdAt: Date.now(),
      storage_type: 'supabase',
      program,
      semester: String(semester),
      subject,
      filename: fileName,
      size,
      uploaderUid: req.user.id,
      uploaderEmail: req.user.email || 'unknown@example.com',
      expectedPath: path,
    });

    return res.json({
      storage_type: 'supabase',
      bucket: SUPABASE_BUCKET,
      path,
      token: data.token,
      uploadId,
    });
  } catch (err) {
    console.error('[storageUpload] init-upload error:', err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Could not start upload' });
  }
});

// POST /api/storage/complete
// body: { storage_type, storage_ref, program, semester, subject, filename, size, uploadId }
// -> { message, url, storage_type, id }
router.post('/complete', requireAuth, express.json(), async (req, res) => {
  try {
    cleanupExpiredGrants();

    const { storage_type, storage_ref, uploadId } = req.body || {};
    if (!storage_type || !storage_ref) {
      return res.status(400).json({ message: 'Missing storage_type or storage_ref' });
    }

    // Prefer the grant recorded at init time — it's the source of truth for
    // program/semester/subject/filename/size, so a client can't smuggle in
    // different metadata between init and complete.
    const grant = uploadId ? pendingUploads.get(uploadId) : null;
    if (uploadId && !grant) {
      return res.status(400).json({ message: 'Upload session expired or not found. Please retry.' });
    }
    if (grant && grant.uploaderUid !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (grant && grant.storage_type !== storage_type) {
      return res.status(400).json({ message: 'storage_type does not match init-upload grant' });
    }
    if (grant?.expectedPath && grant.expectedPath !== storage_ref) {
      return res.status(400).json({ message: 'storage_ref does not match init-upload grant' });
    }

    const program = grant?.program ?? req.body.program;
    const semester = grant?.semester ?? String(req.body.semester);
    const subject = grant?.subject ?? req.body.subject;
    const filename = grant?.filename ?? req.body.filename;
    const size = grant?.size ?? req.body.size;

    if (!program || !semester || !subject || !filename) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    let url;
    if (storage_type === 'gdrive') {
      url = `/api/drive/${storage_ref}`;
    } else if (storage_type === 'supabase') {
      url = supabaseAdmin.storage.from(SUPABASE_BUCKET).getPublicUrl(storage_ref).data.publicUrl;
    } else {
      return res.status(400).json({ message: 'Unknown storage_type' });
    }

    const id = uuidv4();
    const { error: dbError } = await supabaseAdmin.from('notes').insert([
      {
        id,
        program,
        semester: String(semester),
        course_name: subject,
        filename,
        filepath: storage_ref,
        url,
        storage_type,
        uploader_uid: req.user.id,
        uploader_email: req.user.email || 'unknown@example.com',
        size: String(size),
        uploaded_at: new Date().toISOString(),
      },
    ]);
    if (dbError) throw dbError;

    if (uploadId) pendingUploads.delete(uploadId);

    res.json({ message: 'Upload successful', url, storage_type, id });
  } catch (err) {
    console.error('[storageUpload] complete error:', err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Upload failed' });
  }
});

// Multer errors (legacy /upload route only) — clean JSON instead of
// Express's default HTML error page.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

module.exports = { router, uploadFileToStorage, requireAuth, validateFile };

// ============================================================================
// INTEGRATION NOTES
// ============================================================================
// 1. In server.js, mount this router and remove the old inline app.post('/upload', ...):
//      app.use('/api/storage', require('./storageUpload').router);
//
// 2. Upload.jsx already calls /api/storage/init-upload and /api/storage/complete
//    as written — no frontend changes needed for this option.
//
// 3. Required env vars (same ones server.js already uses):
//      SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//      SUPABASE_BUCKET, OAUTH_CLIENT_JSON, GOOGLE_REFRESH_TOKEN,
//      GOOGLE_DRIVE_FOLDER_ID
//
// 4. Requires global `fetch` (Node 18+). If you're on an older Node runtime,
//    add `const fetch = require('node-fetch');` at the top instead.
//
// 5. `pendingUploads` is an in-memory Map — fine for a single server
//    instance / dev. If you deploy multiple instances behind a load
//    balancer, move grants to Redis or a Supabase table keyed by uploadId,
//    or make sure sticky sessions route a client's init+complete calls to
//    the same instance.
//
// 6. Deliberately left out of this file: the FCM push notification that the
//    original /upload route sent to *every* fcm_token with no program
//    filter. Wire notifications back in at the call site (or a thin wrapper
//    around this router) scoped to the note's program, the way
//    sendNotificationToProgram/notifyNewQuestions already do elsewhere in
//    server.js — don't copy the unscoped version. Best spot: right after
//    the DB insert in the /complete handler.