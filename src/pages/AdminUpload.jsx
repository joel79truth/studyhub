import React, { useState } from 'react';
import { supabase } from '../supabase';

// ✅ Use base URL (without /api/exam) – same as in Quiz.jsx
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const AdminUpload = () => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [existingPaperId, setExistingPaperId] = useState('');
  const [processingExisting, setProcessingExisting] = useState(false);

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
      setResult(null);
      setError(null);
    }
  };

  const handleCameraCapture = async () => {
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

      // ✅ Use full path: base + '/api/exam/upload-past-paper'
      const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult(`✅ Extracted ${data.extracted} questions! Paper ID: ${data.paper_id}`);
      setFile(null);
      setPreview(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

const handleProcessExisting = async () => {
  if (!existingPaperId.trim()) return;
  setProcessingExisting(true);
  setError(null);
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;

    // 1. Fetch the record from the 'past_paper' table
    const { data: paperRecord, error: fetchError } = await supabase
      .from('past_paper')
      .select('*')
      .eq('id', existingPaperId)
      .maybeSingle();

    if (fetchError || !paperRecord) {
      throw new Error('Paper not found: ' + (fetchError?.message || ''));
    }

    // 2. Try to get an image URL using the correct column names
    let imageUrl = paperRecord.file_url || paperRecord.thumbnail_url;

    // 3. If not found, build from storage_path
    if (!imageUrl && paperRecord.storage_path) {
      const decodedPath = decodeURIComponent(paperRecord.storage_path);
      const bucketName = 'past-paper'; // matches your Supabase bucket
      const { data: publicUrlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(decodedPath);
      imageUrl = publicUrlData?.publicUrl;
    }

    // 4. If still no URL, throw a helpful error
    if (!imageUrl) {
      throw new Error(
        'No image URL found. Available columns: ' + Object.keys(paperRecord).join(', ')
      );
    }

    // 5. Download the image and process it
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('Failed to download image: ' + response.statusText);
    const blob = await response.blob();
    const imageFile = new File([blob], 'past-paper.jpg', { type: blob.type });

    const formData = new FormData();
    formData.append('paper', imageFile);

    const res = await fetch(`${BASE_URL}/api/exam/upload-past-paper`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Processing failed');
    setResult(`✅ Extracted ${data.extracted} questions from paper ${existingPaperId}`);
  } catch (err) {
    setError(err.message);
  } finally {
    setProcessingExisting(false);
  }
};
  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <h2>Admin: Past Paper Extraction</h2>
      <p>Upload new images or process existing ones from storage.</p>

      <div style={{ marginBottom: '24px', background: '#f9f9f9', padding: '16px', borderRadius: '12px' }}>
        <h3>Upload New Image</h3>
        <button onClick={() => document.getElementById('fileInput').click()} style={btnStyle}>
          Choose from Gallery
        </button>
        <button onClick={handleCameraCapture} style={{ ...btnStyle, marginLeft: '8px' }}>
          Take Photo
        </button>
        <input
          id="fileInput"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        {preview && (
          <div style={{ marginTop: '12px' }}>
            <img src={preview} alt="preview" style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '8px' }} />
            <br />
            <button onClick={handleUploadAndExtract} disabled={uploading} style={{ ...btnStyle, background: '#10b981', marginTop: '8px' }}>
              {uploading ? 'Extracting...' : 'Upload & Extract'}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '24px', background: '#f9f9f9', padding: '16px', borderRadius: '12px' }}>
        <h3>Process Existing Paper</h3>
        <input
          type="text"
          placeholder="Paper UUID"
          value={existingPaperId}
          onChange={(e) => setExistingPaperId(e.target.value)}
          style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ccc', marginBottom: '8px' }}
        />
        <button onClick={handleProcessExisting} disabled={processingExisting} style={btnStyle}>
          {processingExisting ? 'Processing...' : 'Extract from Existing Paper'}
        </button>
      </div>

      {result && <div style={{ background: '#d1fae5', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>{result}</div>}
      {error && <div style={{ background: '#fee2e2', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>{error}</div>}
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