// src/components/UpdateChecker.jsx
import React, { useEffect, useState } from 'react';
import { updateService } from '../services/updateService';
import UpdateModal from './UpdateModal';

export default function UpdateChecker() {
  const [updateState, setUpdateState] = useState({
    isOpen: false,
    updateInfo: null,
    currentVersion: null,
  });

  useEffect(() => {
    let mounted = true;

    const performBackgroundCheck = async () => {
      try {
        const result = await updateService.checkForUpdates({ forceCheck: false });
        if (mounted && result?.hasUpdate) {
          setUpdateState({
            isOpen: true,
            updateInfo: result.updateInfo,
            currentVersion: result.currentVersion,
          });
        }
      } catch (err) {
        console.warn('[UpdateChecker] Automatic update check error:', err);
      }
    };

    // Small timeout after app boot to allow primary page rendering
    const timer = setTimeout(() => {
      performBackgroundCheck();
    }, 2500);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  const handleClose = () => {
    setUpdateState((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <UpdateModal
      isOpen={updateState.isOpen}
      updateInfo={updateState.updateInfo}
      currentVersion={updateState.currentVersion}
      onClose={handleClose}
      onDismiss={handleClose}
    />
  );
}
