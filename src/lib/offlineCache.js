// src/lib/offlineCache.js
// Cache-first / stale-while-revalidate data loading for Supabase queries,
// plus a generalized offline write queue. This is the same pattern you
// already built for quiz answer submission (localStorage queue) — this
// version moves it to IndexedDB and extends it to notes, past papers,
// and Sage so ALL writes survive a dropped connection, not just quizzes.

import { getAll, putAll, setMeta, getMeta, getDB } from './db';

const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours — tune per content type

/**
 * Loads a list from IndexedDB first (instant, works fully offline),
 * then refreshes from Supabase in the background if online and stale.
 *
 * @param storeName  'notes' | 'pastPapers' | 'quizzes'
 * @param fetcher    async () => rows   (your existing Supabase query)
 */
export async function cacheFirst(storeName, fetcher, { forceRefresh = false } = {}) {
  const cached = await getAll(storeName);
  const lastSync = await getMeta(`${storeName}:lastSync`);
  const isStale = !lastSync || Date.now() - lastSync > STALE_MS;

  const refresh = async () => {
    if (!navigator.onLine) return null;
    try {
      const fresh = await fetcher();
      if (fresh?.length) {
        await putAll(storeName, fresh);
        await setMeta(`${storeName}:lastSync`, Date.now());
      }
      return fresh;
    } catch (err) {
      console.warn(`[offlineCache] refresh failed for ${storeName}`, err);
      return null; // network flaked — caller still has `cached`
    }
  };

  if (cached.length && !forceRefresh) {
    if (isStale) refresh(); // fire-and-forget background refresh, UI never blocks
    return { data: cached, fromCache: true, stale: isStale };
  }

  const fresh = await refresh();
  return { data: fresh ?? cached, fromCache: !fresh, stale: false };
}

/**
 * Queue a write (quiz answer, note edit, Sage question) for sync later.
 * type: 'quiz_answer' | 'note' | 'sage_query' | ...
 */
export async function queueForSync(type, payload) {
  const db = await getDB();
  await db.add('syncQueue', { type, payload, createdAt: Date.now() });
  registerBackgroundSync();
}

export async function getQueuedItems() {
  return getAll('syncQueue');
}

export async function clearQueuedItem(id) {
  const db = await getDB();
  return db.delete('syncQueue', id);
}

async function registerBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('studyhub-sync');
      return;
    } catch {
      // fall through to manual flush
    }
  }
  // iOS Safari has no Background Sync API — flushSyncQueue() gets called
  // from the 'online' event in useNetworkStatus instead.
}

/**
 * Replays queued writes in order, stopping at the first failure so nothing
 * gets skipped or reordered. Call on app start and on the 'online' event.
 *
 * handlers = { quiz_answer: (payload) => supabase call, sage_query: ..., note: ... }
 */
export async function flushSyncQueue(handlers) {
  const items = await getQueuedItems();
  for (const item of items) {
    const handler = handlers[item.type];
    if (!handler) continue;
    try {
      await handler(item.payload);
      await clearQueuedItem(item.id);
    } catch (err) {
      console.warn('[offlineCache] sync failed, will retry later', item.type, err);
      break;
    }
  }
}