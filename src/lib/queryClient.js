// src/lib/queryClient.js
// One QueryClient instance + an IndexedDB persister. This is the ONLY
// change needed to make every existing useQuery() call across the app —
// PastPapers, quiz, Home, ExamFocusPanel, LastMinutePanel, etc. — survive
// a reload with no network, without touching any of those files.
//
// npm i idb-keyval

import { QueryClient } from '@tanstack/react-query';
import { get, set, del } from 'idb-keyval';

const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24; // 24 hours

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // Renamed from `cacheTime` (RQ v4) to `gcTime` (v5). App.jsx still had
      // `cacheTime: 10 * 60 * 1000`, which v5 silently ignores — GC has
      // actually been running on v5's default (5 min) the whole time.
      // Bumped to match PERSIST_MAX_AGE so persisted data isn't
      // garbage-collected from memory before it's ever restored on reload.
      gcTime: PERSIST_MAX_AGE,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const idbPersister = {
  persistClient: async (client) => {
    await set('studyhub-query-cache', client);
  },
  restoreClient: async () => {
    return await get('studyhub-query-cache');
  },
  removeClient: async () => {
    await del('studyhub-query-cache');
  },
};

export { PERSIST_MAX_AGE };