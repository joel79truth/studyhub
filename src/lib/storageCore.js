// src/lib/storageCore.js
// Unified IndexedDB storage layer for StudyHub offline operations.
// Consolidates documents, quiz bank, and offline mutation queues into a single durable store.

import { openDB } from 'idb';

const DB_NAME = 'studyhub_core_v1';
const DB_VERSION = 1;

let dbPromise = null;

export async function getStorageCoreDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'fileId' });
          docStore.createIndex('byCourse', 'course');
          docStore.createIndex('byCreatedAt', 'downloadedAt');
        }
        if (!db.objectStoreNames.contains('quizBank')) {
          db.createObjectStore('quizBank', { keyPath: 'courseId' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
          syncStore.createIndex('byCreatedAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    }).catch((err) => {
      console.warn('[storageCore] IndexedDB open failed:', err);
      return null;
    });
  }
  return dbPromise;
}

// ─── Documents Store ─────────────────────────────────────────────────────────

export async function saveDocument(fileId, blob, meta = {}) {
  const db = await getStorageCoreDB();
  if (!db) return false;
  try {
    await db.put('documents', {
      fileId: String(fileId),
      blob,
      size: blob.size,
      downloadedAt: Date.now(),
      filename: meta.filename || meta.name || 'document.pdf',
      course: meta.course || meta.course_name || 'General',
      fileType: meta.fileType || 'pdf',
      ...meta,
    });
    return true;
  } catch (err) {
    console.error('[storageCore] saveDocument error:', err);
    return false;
  }
}

export async function getDocument(fileId) {
  if (!fileId) return null;
  const db = await getStorageCoreDB();
  if (!db) return null;
  try {
    const item = await db.get('documents', String(fileId));
    if (item?.blob) return item;

    // Check legacy store 'studynotes-downloads'
    try {
      const legacyDB = await openDB('studynotes-downloads', 1).catch(() => null);
      if (legacyDB && legacyDB.objectStoreNames.contains('downloads')) {
        const legacyItem = await legacyDB.get('downloads', fileId);
        if (legacyItem?.blob) {
          // Auto-migrate to unified storage
          await saveDocument(fileId, legacyItem.blob, legacyItem);
          return legacyItem;
        }
      }
    } catch (_) {}

    // Check legacy store 'studyhub-offline'
    try {
      const legacyOffline = await openDB('studyhub-offline', 1).catch(() => null);
      if (legacyOffline && legacyOffline.objectStoreNames.contains('cachedFiles')) {
        const legacyCached = await legacyOffline.get('cachedFiles', fileId);
        if (legacyCached?.blob) {
          await saveDocument(fileId, legacyCached.blob, legacyCached.metadata || {});
          return legacyCached;
        }
      }
    } catch (_) {}

    return null;
  } catch (err) {
    console.warn('[storageCore] getDocument error:', err);
    return null;
  }
}

export async function hasDocument(fileId) {
  const doc = await getDocument(fileId);
  return !!doc;
}

export async function deleteDocument(fileId) {
  if (!fileId) return false;
  const db = await getStorageCoreDB();
  if (!db) return false;
  try {
    await db.delete('documents', String(fileId));
    // Also clean up legacy stores if present
    try {
      const leg1 = await openDB('studynotes-downloads', 1).catch(() => null);
      if (leg1 && leg1.objectStoreNames.contains('downloads')) await leg1.delete('downloads', fileId);
    } catch (_) {}
    try {
      const leg2 = await openDB('studyhub-offline', 1).catch(() => null);
      if (leg2 && leg2.objectStoreNames.contains('cachedFiles')) await leg2.delete('cachedFiles', fileId);
    } catch (_) {}
    return true;
  } catch (err) {
    console.warn('[storageCore] deleteDocument error:', err);
    return false;
  }
}

export async function listDocuments() {
  const db = await getStorageCoreDB();
  if (!db) return [];
  try {
    return await db.getAll('documents');
  } catch {
    return [];
  }
}

export async function listDocumentIds() {
  const db = await getStorageCoreDB();
  if (!db) return [];
  try {
    return await db.getAllKeys('documents');
  } catch {
    return [];
  }
}

// ─── Quiz Bank Store ─────────────────────────────────────────────────────────

export async function saveQuizBank(courseId, questions) {
  if (!courseId || !questions?.length) return;
  const db = await getStorageCoreDB();
  if (!db) return;
  try {
    await db.put('quizBank', {
      courseId: String(courseId),
      questions,
      count: questions.length,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('[storageCore] saveQuizBank error:', err);
  }
}

export async function getQuizBank(courseId) {
  if (!courseId) return null;
  const db = await getStorageCoreDB();
  if (!db) return null;
  try {
    const entry = await db.get('quizBank', String(courseId));
    return entry?.questions || null;
  } catch {
    return null;
  }
}

export async function getAllCachedQuizCourses() {
  const db = await getStorageCoreDB();
  if (!db) return [];
  try {
    return await db.getAll('quizBank');
  } catch {
    return [];
  }
}

// ─── Offline Sync Queue ─────────────────────────────────────────────────────

export async function enqueueSyncItem(type, payload) {
  const db = await getStorageCoreDB();
  if (!db) return null;
  try {
    const id = await db.add('syncQueue', {
      type,
      payload,
      createdAt: Date.now(),
      attempts: 0,
    });
    return id;
  } catch (err) {
    console.error('[storageCore] enqueueSyncItem error:', err);
    return null;
  }
}

export async function getSyncQueue() {
  const db = await getStorageCoreDB();
  if (!db) return [];
  try {
    return await db.getAll('syncQueue');
  } catch {
    return [];
  }
}

export async function removeSyncItem(id) {
  const db = await getStorageCoreDB();
  if (!db) return;
  try {
    await db.delete('syncQueue', id);
  } catch {}
}

export async function incrementSyncAttempts(id) {
  const db = await getStorageCoreDB();
  if (!db) return;
  try {
    const item = await db.get('syncQueue', id);
    if (item) {
      item.attempts = (item.attempts || 0) + 1;
      item.lastAttemptAt = Date.now();
      await db.put('syncQueue', item);
    }
  } catch {}
}

// ─── Storage Quota Estimation ───────────────────────────────────────────────

export async function getStorageQuota() {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const usedMB = Math.round(usage / (1024 * 1024));
      const totalMB = Math.round(quota / (1024 * 1024));
      const percent = totalMB > 0 ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
      return { usedMB, totalMB, percent, availableMB: Math.max(0, totalMB - usedMB) };
    } catch {}
  }
  return { usedMB: 0, totalMB: 0, percent: 0, availableMB: 0 };
}
