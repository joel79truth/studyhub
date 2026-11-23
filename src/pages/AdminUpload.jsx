import React from 'react';
import Upload from './Upload';

/**
 * AdminUpload.jsx
 * Unified Resource Contributor Portal in Administrator Mode.
 * Reuses the single unified upload interface as required by Part 2,
 * ensuring no duplicate upload implementations exist.
 */
export default function AdminUpload() {
  return <Upload isAdminMode={true} />;
}
