// src/components/OfflineCoursePackModal.jsx
import React, { useState } from 'react';
import { DownloadCloud, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react';
import { saveDocument, hasDocument } from '../lib/storageCore';
import { supabase } from '../supabase';

const getNoteDownloadUrl = (note) => {
  if (note.storage_type === 'gdrive' && note.filepath) {
    return `https://drive.google.com/uc?export=download&id=${note.filepath}`;
  }
  if (note.filepath && note.storage_type !== 'gdrive') {
    const { data } = supabase.storage.from('notes').getPublicUrl(note.filepath);
    if (data?.publicUrl) return data.publicUrl;
  }
  return note.url || null;
};

export default function OfflineCoursePackModal({ isOpen, onClose, courseName, notes = [] }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentFile: '' });
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const startDownloadPack = async () => {
    if (!notes.length) {
      setErrorMsg('No notes found in this course to download.');
      return;
    }
    setDownloading(true);
    setErrorMsg('');
    setProgress({ current: 0, total: notes.length, currentFile: 'Preparing pack...' });

    let completed = 0;
    for (const note of notes) {
      setProgress({ current: completed, total: notes.length, currentFile: note.filename || 'Document' });
      try {
        const alreadySaved = await hasDocument(note.id);
        if (!alreadySaved) {
          const downloadUrl = getNoteDownloadUrl(note);
          if (downloadUrl) {
            const res = await fetch(downloadUrl);
            if (res.ok) {
              const blob = await res.blob();
              await saveDocument(note.id, blob, {
                filename: note.filename,
                course: note.course || courseName,
                fileType: note.filename?.endsWith('.pptx') ? 'pptx' : 'pdf',
              });
            }
          }
        }
      } catch (err) {
        console.warn('Failed downloading note for pack:', note.id, err);
      }
      completed++;
      setProgress({ current: completed, total: notes.length, currentFile: note.filename || 'Document' });
    }

    setDownloading(false);
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative border border-gray-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 rounded-full p-1"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <DownloadCloud size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 leading-tight">Offline Study Pack</h3>
            <p className="text-xs text-gray-500">{courseName || 'Selected Course'}</p>
          </div>
        </div>

        {!done ? (
          <div>
            <p className="text-sm text-gray-600 mb-4 leading-relaxed">
              Download all <strong>{notes.length}</strong> course notes and documents to your device. Once downloaded, you can study them anywhere with <strong>zero mobile data</strong>.
            </p>

            {downloading && (
              <div className="mb-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div className="flex justify-between text-xs text-gray-600 mb-2 font-medium">
                  <span className="truncate max-w-[240px]">{progress.currentFile}</span>
                  <span>{progress.current} / {progress.total}</span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${progress.total ? Math.round((progress.current / progress.total) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-xs">
                <AlertCircle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={onClose}
                disabled={downloading}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={startDownloadPack}
                disabled={downloading}
                className="px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium shadow-sm flex items-center gap-2 transition disabled:opacity-50"
              >
                {downloading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Downloading...
                  </>
                ) : (
                  'Download Everything'
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle size={32} />
            </div>
            <h4 className="text-base font-bold text-gray-900 mb-1">Study Pack Ready!</h4>
            <p className="text-xs text-gray-600 mb-6">
              All files are safely saved in device storage and ready for offline reading.
            </p>
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-xl shadow-sm transition"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
