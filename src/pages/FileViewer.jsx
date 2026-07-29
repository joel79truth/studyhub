import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function FileViewer() {
  const location = useLocation();
  const navigate = useNavigate();
  const { url, filename } = location.state || {};
  const [loading, setLoading] = useState(true);

  if (!url) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">No file to display.</p>
      </div>
    );
  }

  // Google Docs Viewer – supports PDF, Word, Excel, PowerPoint, etc.
  const viewerUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;

  return (
    <div className="h-screen w-full flex flex-col bg-white relative">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-blue-600 text-white shadow-md z-10">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl font-bold hover:bg-blue-700 p-1 rounded"
          aria-label="Go back"
        >
          ←
        </button>
        <span className="text-lg font-semibold truncate flex-1">
          {filename || 'Document'}
        </span>
      </div>

      {/* Loading Spinner */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white z-20">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent" />
        </div>
      )}

      {/* Iframe */}
      <iframe
        src={viewerUrl}
        className="flex-1 w-full"
        title={filename || 'File viewer'}
        style={{ border: 'none' }}
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
        onLoad={() => setLoading(false)}
        loading="lazy"
      />
    </div>
  );
}