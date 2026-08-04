import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const AdminUpload = () => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [existingPaperId, setExistingPaperId] = useState('');
  const [processingExisting, setProcessingExisting] = useState(false);
  const fileInputRef = useRef(null);

  // Revoke old object URL to prevent memory leaks
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      if (preview) URL.revokeObjectURL(preview);
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
      setResult(null);
      setError(null);
    }
  };

  const handleCameraCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e) => handleFileChange(e);
    input.click();
  };

  const handleUploadAndExtract = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const formData = new FormData();
      formData.append('paper', file);

      const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setResult(`✅ Extracted ${data.extracted} questions! New Paper ID: ${data.paper_id}`);
      setFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleProcessExisting = async () => {
    const trimmedId = existingPaperId.trim();
    if (!trimmedId) return;

    // Basic UUID format check
    if (!/^[0-9a-fA-F-]{36}$/.test(trimmedId)) {
      setError('Invalid Paper UUID format (should be 36 characters).');
      return;
    }

    setProcessingExisting(true);
    setError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;

      // ✅ Query the correct table: past_paper (singular)
      const { data: paperRecord, error: fetchError } = await supabase
        .from('past_paper')                // <-- singular table name
        .select('file_url, thumbnail_url, storage_path')
        .eq('id', trimmedId)
        .maybeSingle();

      if (fetchError || !paperRecord) {
        throw new Error('Paper not found in the past_paper table. Please check the UUID.');
      }

      // Build a public URL from available fields
      let imageUrl = paperRecord.file_url || paperRecord.thumbnail_url;

      if (!imageUrl && paperRecord.storage_path) {
        const bucketName = import.meta.env.VITE_STORAGE_BUCKET || 'past-paper'; // adjust if different
        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(paperRecord.storage_path); // no need to decode; getPublicUrl handles it
        imageUrl = publicUrlData?.publicUrl;
      }

      if (!imageUrl) {
        throw new Error(
          'No image URL available. The paper record may be incomplete. ' +
          'Available fields: ' + Object.keys(paperRecord).join(', ')
        );
      }

      // Download the image
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error('Failed to download image: ' + response.statusText);
      const blob = await response.blob();
      const imageFile = new File([blob], 'past-paper.jpg', { type: blob.type });

      // Send to the extraction endpoint (creates a NEW paper_id group)
      const formData = new FormData();
      formData.append('paper', imageFile);

      const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Processing failed');

      setResult(
        `✅ Reprocessed paper ${trimmedId}. Created new group ${data.paper_id} with ${data.extracted} questions.`
      );
      setExistingPaperId(''); // clear input after success
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingExisting(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <h2>Admin: Past Paper Extraction</h2>
      <p>Upload a new past paper image or reprocess one already stored.</p>

      {/* New Upload Section */}
      <div style={{ marginBottom: '24px', background: '#f9f9f9', padding: '16px', borderRadius: '12px' }}>
        <h3>Upload New Image</h3>
        <button onClick={() => fileInputRef.current?.click()} style={btnStyle} aria-label="Choose from gallery">
          Choose from Gallery
        </button>
        <button onClick={handleCameraCapture} style={{ ...btnStyle, marginLeft: '8px' }} aria-label="Take photo">
          Take Photo
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
        {preview && (
          <div style={{ marginTop: '12px' }}>
            <img src={preview} alt="Preview" style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '8px' }} />
            <br />
            <button
              onClick={handleUploadAndExtract}
              disabled={uploading}
              style={{ ...btnStyle, background: '#10b981', marginTop: '8px' }}
            >
              {uploading ? 'Extracting...' : 'Upload & Extract'}
            </button>
          </div>
        )}
      </div>

      {/* Reprocess Existing Section */}
      <div style={{ marginBottom: '24px', background: '#f9f9f9', padding: '16px', borderRadius: '12px' }}>
        <h3>Reprocess Existing Paper</h3>
        <p style={{ fontSize: '0.85rem', color: '#555' }}>
          This downloads the original image and creates a <strong>new</strong> set of extracted questions.
          The original paper record remains unchanged.
        </p>
        <input
          type="text"
          placeholder="Paper UUID (from past_paper table)"
          value={existingPaperId}
          onChange={(e) => setExistingPaperId(e.target.value)}
          style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ccc', marginBottom: '8px' }}
          aria-label="Existing paper UUID"
        />
        <button onClick={handleProcessExisting} disabled={processingExisting} style={btnStyle}>
          {processingExisting ? 'Processing...' : 'Reprocess from Storage'}
        </button>
      </div>

      {result && (
        <div style={{ background: '#d1fae5', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
          {result}
        </div>
      )}
      {error && (
        <div style={{ background: '#fee2e2', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
          {error}
        </div>
      )}
    </div>
  );
};

const btnStyle = {
  padding: '8px 16px',
  background: '#2563eb',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '0.9rem',
};

export default AdminUpload;