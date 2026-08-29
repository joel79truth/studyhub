const DB_NAME = 'studyhub-offline';
const STORE_NAME = 'cachedFiles';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Wraps a transaction in a real promise that resolves on tx.oncomplete
// and rejects on tx.onerror/onabort. Native IndexedDB transactions have
// no `.complete` property (that's a wrapper-library API) — without this,
// callers can get a false "success" before the write is actually durable.
function runTx(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    result = work(tx.objectStore(STORE_NAME));
  });
}

export async function saveFileOffline(fileId, blob, metadata = {}) {
  const db = await openDB();
  await runTx(db, 'readwrite', (store) => {
    store.put({
      fileId,
      blob,
      metadata: { ...metadata, savedAt: Date.now() },
    });
  });
}

export async function getOfflineFile(fileId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve, reject) => {
    const request = store.get(fileId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteOfflineFile(fileId) {
  const db = await openDB();
  await runTx(db, 'readwrite', (store) => {
    store.delete(fileId);
  });
}

// New: lets the header/UI show accurate offline status and a way to
// clear space, without needing a third parallel storage mechanism.
export async function isFileOffline(fileId) {
  const record = await getOfflineFile(fileId);
  return !!record;
}