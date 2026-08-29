import { saveFileOffline, getOfflineFile, deleteOfflineFile } from '../utils/offlineStorage';

export function useOfflineFile(fileId) {
  const [isOffline, setIsOffline] = useState(false);
  const [isSaving, setIsSaving]   = useState(false);

  useEffect(() => {
    if (!fileId) return;
    getOfflineFile(fileId).then(cached => setIsOffline(!!cached));
  }, [fileId]);

  const saveOffline = async (blob, meta) => {
    setIsSaving(true);
    try {
      await saveFileOffline(fileId, blob, meta);
      setIsOffline(true);
    } finally {
      setIsSaving(false);
    }
  };

  const removeOffline = async () => {
    await deleteOfflineFile(fileId);
    setIsOffline(false);
  };

  return { isOffline, isSaving, saveOffline, removeOffline };
}