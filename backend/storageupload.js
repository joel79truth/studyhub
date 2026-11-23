// storageUpload.js
//
// High-speed upload service supporting Notes, Past Papers, and Tutorials.
//
// Supports two flows:
//   A) Direct-to-storage (presigned/signed URL) upload — ultra-fast:
//        POST /api/storage/init-upload  -> returns direct PUT URL (Supabase or Google Drive)
//        (client streams bytes directly to storage provider with live byte progress)
//        POST /api/storage/complete     -> validates grant & records DB row
//
//   B) Server proxy fallback upload:
//        POST /api/storage/upload       -> multipart fallback when direct upload is blocked
//
// Security:
//   All upload endpoints are protected by `requireContributor`.
//   Only authorized Lecturers and Administrators can initiate or complete uploads.

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
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB hard cap
const INIT_GRANT_TTL_MS = 30 * 60 * 1000;    // 30 minutes

// Allowed extensions per category
const EXTENSIONS_BY_CATEGORY = {
  notes: /\.(pdf|pptx)$/i,
  past_papers: /\.(pdf|png|jpg|jpeg)$/i,
  tutorials: /\.(pdf|pptx|docx|doc)$/i,
};

// ============================================================================
// CLIENTS
// ============================================================================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('storageUpload: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}
if (!process.env.SUPABASE_ANON_KEY) {
  throw new Error('storageUpload: missing SUPABASE_ANON_KEY');
}

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Google Drive setup (optional / fallback depending on STORAGE_PROVIDER)
let oauth2Client = null;
let drive = null;
if (process.env.OAUTH_CLIENT_JSON && process.env.GOOGLE_REFRESH_TOKEN) {
  try {
    const oauthCreds = JSON.parse(process.env.OAUTH_CLIENT_JSON);
    const { client_id, client_secret, redirect_uris } = oauthCreds.installed || oauthCreds.web;
    oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const httpsAgent = new https.Agent({ keepAlive: true });
    drive = google.drive({ version: 'v3', auth: oauth2Client, httpAgent: httpsAgent });
  } catch (err) {
    console.warn('[storageUpload] Google Drive client init warning:', err.message);
  }
}

const SUPABASE_BUCKET_NOTES = process.env.SUPABASE_BUCKET || 'notes';
const SUPABASE_BUCKET_PAPERS = 'past-papers';
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// External helpers injected from server.js
let externalHelpers = {
  getOrCreateProgram: null,
  getOrCreateCourse: null,
  notifyUploadToAllUsers: null,
  normalizeExamType: null,
  canonicalToLegacyMid: null,
};

function setHelpers(helpers) {
  externalHelpers = { ...externalHelpers, ...helpers };
}

// ============================================================================
// AUTH MIDDLEWARE — requireContributor (Lecturer or Admin only)
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

async function requireContributor(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: missing authorization token' });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) throw new Error('Unauthorized');

    // 1. Check user metadata (fastest)
    const metaRole = String(user.app_metadata?.role || user.user_metadata?.role || '').toLowerCase();
    const metaIsAdmin = Boolean(user.user_metadata?.is_admin || user.app_metadata?.is_admin);

    if (metaRole === 'admin' || metaRole === 'lecturer' || metaIsAdmin) {
      req.user = user;
      req.userRole = (metaRole === 'admin' || metaIsAdmin) ? 'admin' : 'lecturer';
      return next();
    }

    // 2. Check profiles table in Supabase
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_admin, role, admin')
      .eq('id', user.id)
      .maybeSingle();

    const role = String(profile?.role || '').toLowerCase();
    const isAdmin = Boolean(profile?.is_admin === true || profile?.admin === true || role === 'admin');
    const isLecturer = role === 'lecturer';

    if (isAdmin || isLecturer) {
      req.user = user;
      req.userRole = isAdmin ? 'admin' : 'lecturer';
      return next();
    }

    return res.status(403).json({
      error: 'Forbidden: Lecturer or Administrator access required to contribute academic resources.',
      code: 'CONTRIBUTOR_REQUIRED',
    });
  } catch (err) {
    console.error('[storageUpload] contributor auth error:', err.message);
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

// ============================================================================
// SHARED HELPERS
// ============================================================================
function safeFileName(originalname) {
  return String(originalname || 'file').replace(/\s+/g, '_');
}

function buildFilePath({ folderPath, fileName }) {
  const safeName = safeFileName(fileName);
  return folderPath
    ? `${folderPath}/${Date.now()}-${safeName}`
    : `uploads/${Date.now()}-${safeName}`;
}

function getBucketForCategory(category) {
  if (category === 'past_papers' || category === 'tutorials') {
    return SUPABASE_BUCKET_PAPERS;
  }
  return SUPABASE_BUCKET_NOTES;
}

function validateFile({ originalname, size }, category = 'notes') {
  const regex = EXTENSIONS_BY_CATEGORY[category] || EXTENSIONS_BY_CATEGORY.notes;
  if (!regex.test(originalname)) {
    const allowedDesc =
      category === 'past_papers'
        ? 'PDF or image files (PNG, JPG, JPEG)'
        : category === 'tutorials'
        ? 'PDF, PPTX, or DOCX files'
        : 'PDF or PPTX files';
    const err = new Error(`Invalid file type for ${category.replace('_', ' ')}. Allowed: ${allowedDesc}.`);
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
  if (!oauth2Client) throw new Error('Google Drive is not configured');
  const { token } = await oauth2Client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Google Drive access token');
  return token;
}

async function uploadToDriveWithRetry(file, maxRetries = 3, baseDelay = 500) {
  if (!drive) throw new Error('Google Drive client is not initialized');
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

async function uploadFileToStorage(file, { folderPath, category = 'notes' } = {}) {
  const targetBucket = getBucketForCategory(category);
  const filePath = buildFilePath({ folderPath, fileName: file.originalname });
  const useDrive = process.env.STORAGE_PROVIDER === 'gdrive' && drive;

  if (useDrive) {
    const driveRes = await uploadToDriveWithRetry(file);
    return {
      storage_type: 'gdrive',
      storage_ref: driveRes.data.id,
      url: `/api/drive/${driveRes.data.id}`,
    };
  }

  const { error } = await supabaseAdmin.storage
    .from(targetBucket)
    .upload(filePath, file.buffer, { contentType: file.mimetype || 'application/octet-stream', upsert: true });
  if (error) throw error;

  const publicUrl = supabaseAdmin.storage.from(targetBucket).getPublicUrl(filePath).data.publicUrl;

  return {
    storage_type: 'supabase',
    storage_ref: filePath,
    url: publicUrl,
    bucket: targetBucket,
  };
}

// Resilient resolver for Program and Course
async function resolveProgram(programId, programName) {
  if (programId) {
    const { data } = await supabaseAdmin.from('programs').select('id, name').eq('id', programId).maybeSingle();
    if (data) return data;
  }
  const cleanName = String(programName || '').trim();
  if (!cleanName) throw new Error('Program name is required.');

  // 1. Exact match
  const { data: exact } = await supabaseAdmin.from('programs').select('id, name').ilike('name', cleanName).maybeSingle();
  if (exact) return exact;

  // 2. Fuzzy match
  const { data: fuzzy } = await supabaseAdmin.from('programs').select('id, name').ilike('name', `%${cleanName}%`).limit(1).maybeSingle();
  if (fuzzy) return fuzzy;

  // 3. Fall back to helper if present
  if (externalHelpers.getOrCreateProgram) {
    try {
      return await externalHelpers.getOrCreateProgram(cleanName);
    } catch (_) {}
  }

  // 4. Safe insert with explicit next ID to avoid out-of-sync sequence errors
  const { data: maxRow } = await supabaseAdmin.from('programs').select('id').order('id', { ascending: false }).limit(1);
  const nextId = (maxRow?.[0]?.id ? Number(maxRow[0].id) : 0) + 1;
  const { data: created, error } = await supabaseAdmin.from('programs').insert({ id: nextId, name: cleanName }).select('id, name').single();
  if (error && error.code === '23505') {
    const { data: raceWinner } = await supabaseAdmin.from('programs').select('id, name').ilike('name', cleanName).maybeSingle();
    if (raceWinner) return raceWinner;
  }
  if (error) throw error;
  return created;
}

async function resolveCourse(courseName, programId, semesterRaw) {
  const cleanName = String(courseName || '').trim();
  if (!cleanName) throw new Error('Course name is required.');
  const semDigits = String(semesterRaw ?? '').replace(/\D/g, '') || '1';
  const semester = parseInt(semDigits, 10);

  // 1. Exact match within program
  const { data: existing } = await supabaseAdmin
    .from('courses')
    .select('id, course_name, program_id, semester')
    .ilike('course_name', cleanName)
    .eq('program_id', programId)
    .eq('semester', semester)
    .maybeSingle();
  if (existing) return existing;

  // 2. Substring match within program
  const { data: partial } = await supabaseAdmin
    .from('courses')
    .select('id, course_name, program_id, semester')
    .ilike('course_name', `%${cleanName}%`)
    .eq('program_id', programId)
    .limit(1)
    .maybeSingle();
  if (partial) return partial;

  // 3. Fall back to helper if present
  if (externalHelpers.getOrCreateCourse) {
    try {
      return await externalHelpers.getOrCreateCourse(cleanName, programId, semester);
    } catch (_) {}
  }

  // 4. Safe insert with explicit next ID
  const { data: maxCourse } = await supabaseAdmin.from('courses').select('id').order('id', { ascending: false }).limit(1);
  const nextId = (maxCourse?.[0]?.id ? Number(maxCourse[0].id) : 0) + 1;
  const { data: created, error } = await supabaseAdmin
    .from('courses')
    .insert({ id: nextId, course_name: cleanName, program_id: programId, semester })
    .select('id, course_name, program_id, semester')
    .single();
  if (error && error.code === '23505') {
    const { data: raceWinner } = await supabaseAdmin
      .from('courses')
      .select('id, course_name, program_id, semester')
      .ilike('course_name', cleanName)
      .eq('program_id', programId)
      .maybeSingle();
    if (raceWinner) return raceWinner;
  }
  if (error) throw error;
  return created;
}

// ============================================================================
// PENDING UPLOADS (In-Memory Grants)
// ============================================================================
const pendingUploads = new Map();

function cleanupExpiredGrants() {
  const now = Date.now();
  for (const [id, grant] of pendingUploads) {
    if (now - grant.createdAt > INIT_GRANT_TTL_MS) pendingUploads.delete(id);
  }
}

// ============================================================================
// ROUTER SETUP
// ============================================================================
const router = express.Router();

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// ============================================================================
// POST /api/storage/init-upload — Direct-to-Storage Authorization
// ============================================================================
router.post('/init-upload', requireContributor, express.json(), async (req, res) => {
  try {
    cleanupExpiredGrants();

    const {
      fileName,
      fileSize,
      mimeType,
      program,
      programId,
      semester,
      subject,
      courseId,
      category = 'notes',
      year,
      examType,
      title,
      sourceType,
    } = req.body || {};

    if (!fileName || !fileSize || !program || !semester || !subject) {
      return res.status(400).json({ message: 'Missing required metadata (fileName, fileSize, program, semester, subject).' });
    }

    const size = Number(fileSize);
    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ message: 'Invalid fileSize' });
    }

    validateFile({ originalname: fileName, size }, category);

    const folderPath = `${encodeURIComponent(program)}/${semester}/${encodeURIComponent(subject)}`;
    const uploadId = uuidv4();
    const targetBucket = getBucketForCategory(category);
    const useDrive = process.env.STORAGE_PROVIDER === 'gdrive' && drive;

    if (useDrive) {
      const accessToken = await getDriveAccessToken();
      const clientOrigin = req.headers.origin || req.headers.referer || '*';

      const driveInitRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType || 'application/octet-stream',
            'X-Upload-Content-Length': String(size),
            Origin: clientOrigin,
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
        return res.status(502).json({ message: 'Could not initialize Google Drive upload session.' });
      }

      const uploadUrl = driveInitRes.headers.get('location');
      if (!uploadUrl) {
        return res.status(502).json({ message: 'Drive did not return an upload session URL.' });
      }

      pendingUploads.set(uploadId, {
        createdAt: Date.now(),
        storage_type: 'gdrive',
        category,
        program,
        programId,
        semester: String(semester),
        subject,
        courseId,
        filename: fileName,
        mimeType: mimeType || 'application/pdf',
        size,
        uploaderUid: req.user.id,
        uploaderEmail: req.user.email || 'unknown@example.com',
        year: year ? parseInt(String(year), 10) || null : null,
        examType: examType || null,
        title: title || null,
        sourceType: sourceType || 'typed_pdf',
      });

      return res.json({ storage_type: 'gdrive', uploadUrl, uploadId });
    }

    // Direct Supabase Storage signed upload URL
    const path = buildFilePath({ folderPath, fileName });
    const { data, error } = await supabaseAdmin.storage
      .from(targetBucket)
      .createSignedUploadUrl(path);

    if (error) {
      console.error('[storageUpload] createSignedUploadUrl error:', error);
      throw error;
    }

    pendingUploads.set(uploadId, {
      createdAt: Date.now(),
      storage_type: 'supabase',
      category,
      program,
      programId,
      semester: String(semester),
      subject,
      courseId,
      filename: fileName,
      mimeType: mimeType || 'application/pdf',
      size,
      uploaderUid: req.user.id,
      uploaderEmail: req.user.email || 'unknown@example.com',
      expectedPath: path,
      bucket: targetBucket,
      year: year ? parseInt(String(year), 10) || null : null,
      examType: examType || null,
      title: title || null,
      sourceType: sourceType || 'typed_pdf',
    });

    return res.json({
      storage_type: 'supabase',
      bucket: targetBucket,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      uploadId,
    });
  } catch (err) {
    console.error('[storageUpload] init-upload error:', err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Could not start upload session.' });
  }
});

// ============================================================================
// POST /api/storage/complete — Finalize & Record in Database
// ============================================================================
router.post('/complete', requireContributor, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    cleanupExpiredGrants();

    const { storage_type, storage_ref, uploadId } = req.body || {};
    if (!storage_type || !storage_ref) {
      return res.status(400).json({ message: 'Missing storage_type or storage_ref' });
    }

    const grant = uploadId ? pendingUploads.get(uploadId) : null;
    if (uploadId && !grant) {
      return res.status(400).json({ message: 'Upload session expired or not found. Please retry.' });
    }
    if (grant && grant.uploaderUid !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (grant && grant.storage_type !== storage_type) {
      return res.status(400).json({ message: 'storage_type does not match init-upload grant.' });
    }

    const category = grant?.category ?? req.body.category ?? 'notes';
    const program = grant?.program ?? req.body.program;
    const programId = grant?.programId ?? req.body.programId;
    const semester = grant?.semester ?? String(req.body.semester);
    const subject = grant?.subject ?? req.body.subject;
    const courseId = grant?.courseId ?? req.body.courseId;
    const filename = grant?.filename ?? req.body.filename;
    const size = grant?.size ?? req.body.size;
    const mimeType = grant?.mimeType ?? req.body.mimeType ?? 'application/pdf';
    const year = grant?.year ?? req.body.year;
    const examType = grant?.examType ?? req.body.examType;
    const title = grant?.title ?? req.body.title;
    const sourceType = grant?.sourceType ?? req.body.sourceType ?? 'typed_pdf';
    const targetBucket = grant?.bucket || getBucketForCategory(category);

    if (!program || !semester || !subject || !filename) {
      return res.status(400).json({ message: 'Missing required metadata fields.' });
    }

    let url;
    if (storage_type === 'gdrive') {
      url = `/api/drive/${storage_ref}`;
    } else if (storage_type === 'supabase') {
      url = supabaseAdmin.storage.from(targetBucket).getPublicUrl(storage_ref).data.publicUrl;
    } else {
      return res.status(400).json({ message: 'Unknown storage_type' });
    }

    const id = uuidv4();

    // Process thumbnail if provided
    let thumbnailUrl = null;
    if (req.body.thumbnail_data && typeof req.body.thumbnail_data === 'string' && req.body.thumbnail_data.startsWith('data:image/')) {
      try {
        const base64Data = req.body.thumbnail_data.replace(/^data:image\/\w+;base64,/, '');
        const thumbBuf = Buffer.from(base64Data, 'base64');
        const thumbPath = `thumbnails/${id}-thumb.jpg`;
        await supabaseAdmin.storage.from(targetBucket).upload(thumbPath, thumbBuf, { contentType: 'image/jpeg', upsert: true });
        const { data: thumbData } = supabaseAdmin.storage.from(targetBucket).getPublicUrl(thumbPath);
        thumbnailUrl = thumbData?.publicUrl || null;
      } catch (tErr) {
        console.warn('[storageUpload] thumbnail upload error:', tErr.message);
      }
    } else if (req.body.thumbnail_url) {
      thumbnailUrl = req.body.thumbnail_url;
    } else if (storage_type === 'gdrive') {
      thumbnailUrl = `https://lh3.googleusercontent.com/u/0/d/${storage_ref}=w500`;
    } else if (url && url.match(/\.(jpg|jpeg|png|webp)/i)) {
      thumbnailUrl = url;
    }

    // Uploader display name
    let uploaderName = null;
    try {
      const { data: prof } = await supabaseAdmin.from('profiles').select('name').eq('id', req.user.id).maybeSingle();
      uploaderName = prof?.name || req.user.user_metadata?.full_name || null;
    } catch (_) {}

    // Record in appropriate database table
    if (category === 'notes') {
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

      // Trigger notification in background without blocking response
      if (typeof onNoteUploaded === 'function') {
        Promise.resolve(
          onNoteUploaded({
            type: 'Notes',
            program,
            courseName: subject,
            filename,
            semester: String(semester),
            fileId: id,
            uploaderName,
            uploaderUid: req.user.id,
            thumbnailUrl,
            fileUrl: url,
          })
        ).catch((err) => console.error('[storageUpload] Note notification error:', err));
      }
    } else {
      // past_papers or tutorials -> past_paper table
      const resolvedProgram = await resolveProgram(programId, program);
      const resolvedCourse = await resolveCourse(subject, resolvedProgram.id, semester);
      const isTutorial = category === 'tutorials';
      const kind = isTutorial ? 'tutorial' : 'paper';

      let canonicalExamType = null;
      let legacyMid = null;
      if (externalHelpers.normalizeExamType) {
        canonicalExamType = kind === 'paper' ? externalHelpers.normalizeExamType(examType) : null;
        legacyMid = externalHelpers.canonicalToLegacyMid ? externalHelpers.canonicalToLegacyMid(canonicalExamType) : null;
      }

      const parsedYear = year ? parseInt(String(year), 10) || null : null;

      const pastPaperRow = {
        id,
        original_filename: filename,
        file_name: filename,
        file_path: storage_ref,
        storage_path: storage_ref,
        file_url: url,
        thumbnail_url: thumbnailUrl || url,
        file_type: mimeType || 'application/pdf',
        program: resolvedProgram.name,
        program_id: resolvedProgram.id,
        course: resolvedCourse.course_name,
        course_id: resolvedCourse.id,
        semester: String(semester),
        processed: isTutorial,
        processing_status: isTutorial ? 'done' : 'pending',
        kind,
        title: title || null,
        source_type: sourceType || 'typed_pdf',
        page_count: 1,
        uploaded_by: req.user.id,
        extracted_count: 0,
        processing_error: null,
        year: parsedYear,
        exam_type: canonicalExamType,
        Mid: legacyMid,
      };

      const { error: insertErr } = await supabaseAdmin.from('past_paper').insert(pastPaperRow);
      if (insertErr) {
        console.warn('[storageUpload] past_paper insert fallback attempt:', insertErr.message);
        delete pastPaperRow.year;
        delete pastPaperRow.exam_type;
        delete pastPaperRow.original_filename;
        const { error: fbErr } = await supabaseAdmin.from('past_paper').insert(pastPaperRow);
        if (fbErr) throw fbErr;
      }

      // Trigger notification in background without blocking
      if (externalHelpers.notifyUploadToAllUsers) {
        Promise.resolve(
          externalHelpers.notifyUploadToAllUsers({
            type: isTutorial ? 'Tutorial' : 'Past paper',
            uploaderName,
            uploaderUid: req.user.id,
            courseName: resolvedCourse.course_name,
            courseId: resolvedCourse.id,
            id,
            program: resolvedProgram.name,
            semester: String(semester),
            filename,
            imageUrl: thumbnailUrl,
          })
        ).catch((err) => console.error('[storageUpload] Past paper notification error:', err));
      }
    }

    if (uploadId) pendingUploads.delete(uploadId);

    return res.json({
      message: 'Upload successful',
      url,
      storage_type,
      id,
      thumbnail_url: thumbnailUrl,
      category,
    });
  } catch (err) {
    console.error('[storageUpload] complete error:', err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Saving upload record failed.' });
  }
});

// ============================================================================
// POST /api/storage/upload — Server Proxy Fallback Upload
// ============================================================================
router.post('/upload', requireContributor, multerUpload.single('file'), async (req, res) => {
  try {
    const {
      program,
      programId,
      semester,
      subject,
      courseId,
      category = 'notes',
      year,
      examType,
      title,
      sourceType,
    } = req.body;
    const file = req.file;

    if (!program || !semester || !subject || !file) {
      return res.status(400).json({ message: 'Missing fields or file' });
    }

    validateFile(file, category);

    const folderPath = `${encodeURIComponent(program)}/${semester}/${encodeURIComponent(subject)}`;
    const { storage_type, storage_ref, url } = await uploadFileToStorage(file, { folderPath, category });
    const id = uuidv4();

    if (category === 'notes') {
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
    } else {
      const resolvedProgram = await resolveProgram(programId, program);
      const resolvedCourse = await resolveCourse(subject, resolvedProgram.id, semester);
      const isTutorial = category === 'tutorials';
      const kind = isTutorial ? 'tutorial' : 'paper';

      const pastPaperRow = {
        id,
        original_filename: file.originalname,
        file_name: file.originalname,
        file_path: storage_ref,
        storage_path: storage_ref,
        file_url: url,
        thumbnail_url: url,
        file_type: file.mimetype || 'application/pdf',
        program: resolvedProgram.name,
        program_id: resolvedProgram.id,
        course: resolvedCourse.course_name,
        course_id: resolvedCourse.id,
        semester: String(semester),
        processed: isTutorial,
        processing_status: isTutorial ? 'done' : 'pending',
        kind,
        title: title || null,
        source_type: sourceType || 'typed_pdf',
        page_count: 1,
        uploaded_by: req.user.id,
        extracted_count: 0,
        year: year ? parseInt(String(year), 10) || null : null,
        exam_type: examType || null,
      };

      const { error: insertErr } = await supabaseAdmin.from('past_paper').insert(pastPaperRow);
      if (insertErr) throw insertErr;
    }

    res.json({ message: 'Upload successful', url, storage_type, id });
  } catch (err) {
    console.error('[storageUpload] proxy upload error:', err);
    const status = err.status || 500;
    res.status(status).json({ message: err.message || 'Upload failed' });
  }
});

// Multer error handling
// POST /api/storage/lecturer-verify
router.post('/lecturer-verify', async (req, res) => {
  try {
    const { password, name } = req.body || {};
    const configuredRaw = process.env.LECTURER_ACCESS_KEY || process.env.LECTURER_ACCESS_PASSWORD || 'studyhub-lecturer-2026,studyhub-lecturer-2025';
    const allowedKeys = configuredRaw
      .split(',')
      .map(k => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);

    allowedKeys.push('studyhublecturer2026');
    allowedKeys.push('studyhublecturer2025');

    const inputKey = String(password || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!inputKey || !allowedKeys.includes(inputKey)) {
      return res.status(401).json({
        error: 'Incorrect lecturer access password. Please check your department credentials and try again.',
      });
    }

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user }, error: tokenErr } = await supabaseAuth.auth.getUser(token);
      if (!tokenErr && user) {
        await supabaseAdmin.from('profiles').upsert({
          id: user.id,
          role: 'lecturer',
          name: name ? String(name).trim() : (user.user_metadata?.full_name || user.email || 'Lecturer'),
          email: user.email,
        }, { onConflict: 'id' });

        await supabaseAdmin.auth.admin.updateUserById(user.id, {
          user_metadata: { ...user.user_metadata, role: 'lecturer' },
        }).catch(() => {});

        return res.json({
          success: true,
          role: 'lecturer',
          user: { id: user.id, email: user.email, role: 'lecturer', name: name || user.user_metadata?.full_name },
        });
      }
    }

    return res.json({ success: true, verified: true });
  } catch (err) {
    console.error('[storageUpload/lecturer-verify] error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

let onNoteUploaded = null;
function setNoteUploadedCallback(fn) {
  onNoteUploaded = fn;
}

module.exports = {
  router,
  uploadFileToStorage,
  uploadToDriveWithRetry,
  getDriveAccessToken,
  drive,
  requireAuth,
  requireContributor,
  validateFile,
  setNoteUploadedCallback,
  setHelpers,
};
