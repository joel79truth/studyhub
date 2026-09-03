// utils/downloadStore.js
import { openDB } from 'idb';

const DB_NAME = 'studynotes-downloads';
const STORE = 'downloads';

let dbPromise = null;
let dbUnavailable = false;

function getDb() {
  if (dbUnavailable) return Promise.resolve(null);
  if (!dbPromise) {
    // CHANGED: openDB() itself can throw synchronously in some environments
    // (older Android WebViews, locked-down lab machines) rather than
    // rejecting the promise it returns — a plain `.catch()` chained onto it
    // never runs in that case, so it needs its own try/catch too. Both
    // paths now fail soft the same way.
    try {
      dbPromise = openDB(DB_NAME, 1, {
        upgrade(db) {
          const store = db.createObjectStore(STORE, { keyPath: 'fileId' });
          store.createIndex('byCourse', 'course');
        },
      }).catch((e) => {
        // Async failure path: promise rejected (e.g. blocked upgrade,
        // Safari private mode on older versions).
        console.warn('IndexedDB unavailable — downloads disabled this session:', e);
        dbUnavailable = true;
        return null;
      });
    } catch (e) {
      // Sync failure path: indexedDB.open() itself threw.
      console.warn('IndexedDB unavailable — downloads disabled this session:', e);
      dbUnavailable = true;
      dbPromise = Promise.resolve(null);
    }
  }
  return dbPromise;
}

// Distinguishes "ran out of space" from any other failure, so the UI
// can tell the student the actionable thing ("free up space") instead
// of a generic "something went wrong."
function isQuotaError(err) {
  return (
    err?.name === 'QuotaExceededError' ||
    err?.code === 22 || // legacy Firefox/Safari
    /quota/i.test(err?.message || '')
  );
}

export async function putDownload(fileId, blob, meta) {
  const db = await getDb();
  if (!db) return { ok: false, reason: 'unavailable' };
  try {
    await db.put(STORE, {
      fileId,
      blob,
      size: blob.size,
      downloadedAt: Date.now(),
      ...meta, // filename, course, fileType
    });
    return { ok: true };
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('Storage quota exceeded saving download:', fileId);
      return { ok: false, reason: 'quota' };
    }
    console.error('Failed to save download:', err);
    return { ok: false, reason: 'error', error: err };
  }
}

export async function getDownload(fileId) {
  const db = await getDb();
  if (!db) return null;
  try {
    return (await db.get(STORE, fileId)) || null;
  } catch (err) {
    console.warn('Failed to read download:', fileId, err);
    return null;
  }
}

export async function deleteDownload(fileId) {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.delete(STORE, fileId);
    return true;
  } catch (err) {
    console.warn('Failed to delete download:', fileId, err);
    return false;
  }
}

export async function listDownloadIds() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.getAllKeys(STORE);
  } catch (err) {
    console.warn('Failed to list downloads:', err);
    return [];
  }
}

export async function totalDownloadedBytes() {
  const db = await getDb();
  if (!db) return 0;
  try {
    const all = await db.getAll(STORE);
    return all.reduce((sum, d) => sum + (d.size || 0), 0);
  } catch (err) {
    console.warn('Failed to compute total download size:', err);
    return 0;
  }
}

// Best-effort check before a big download: lets the UI warn a student
// ahead of time ("this won't fit") rather than let a multi-second
// download fail at the very last write.
export async function hasRoomFor(bytes) {
  if (!navigator.storage?.estimate) return true; // can't tell — assume yes
  try {
    const { usage = 0, quota = Infinity } = await navigator.storage.estimate();
    return usage + bytes < quota * 0.95; // leave a little headroom
  } catch {
    return true;
  }
}

export async function isStoreAvailable() {
  return (await getDb()) !== null;
}