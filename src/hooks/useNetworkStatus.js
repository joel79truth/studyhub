// src/hooks/useNetworkStatus.js
// Tracks online/offline state and connection quality so components can
// adapt — e.g. skip full-res images, switch Sage to "queued" mode instead
// of spinning forever on 2G near the hostels.

import { useEffect, useState } from 'react';
import { flushSyncQueue } from '../lib/offlineCache';

function getConnectionInfo() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    effectiveType: conn?.effectiveType ?? 'unknown', // '4g' | '3g' | '2g' | 'slow-2g'
    saveData: conn?.saveData ?? false,
    downlink: conn?.downlink ?? null, // Mbps estimate, Chrome/Android only
  };
}

/**
 * @param syncHandlers  optional map passed to flushSyncQueue when the
 *                       connection comes back — e.g. { quiz_answer: fn, sage_query: fn }
 */
export function useNetworkStatus(syncHandlers) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [connection, setConnection] = useState(getConnectionInfo);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      if (syncHandlers) flushSyncQueue(syncHandlers);
    };
    const goOffline = () => setIsOnline(false);
    const updateConnection = () => setConnection(getConnectionInfo());

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const conn = navigator.connection;
    conn?.addEventListener?.('change', updateConnection);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      conn?.removeEventListener?.('change', updateConnection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSlow =
    connection.effectiveType === '2g' ||
    connection.effectiveType === 'slow-2g' ||
    connection.saveData;

  return { isOnline, isSlow, ...connection };
}