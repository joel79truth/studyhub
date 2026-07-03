import { Filesystem, Directory } from '@capacitor/filesystem';
import { Toast } from '@capacitor/toast';
import { supabase } from '../supabase';

export async function handleFileAccess(fileName, supabasePath) {
  const sanitizedPath = `StudyHub_Cache/${fileName.replace(/\s+/g, '_')}`;

  try {
    // File already downloaded? → open local copy
    const fileInfo = await Filesystem.stat({
      path: sanitizedPath,
      directory: Directory.Data
    });
    await Toast.show({ text: 'Opening saved note offline...' });
    return fileInfo.uri;
  } catch {
    // Not found → download & save
    await Toast.show({ text: 'Downloading study material...' });
    const { data } = supabase.storage.from('notes').getPublicUrl(supabasePath);
    const result = await Filesystem.downloadFile({
      url: data.publicUrl,
      path: sanitizedPath,
      directory: Directory.Data
    });
    await Toast.show({ text: 'Saved to device for offline use!' });
    return result.path;
  }
}