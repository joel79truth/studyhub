// src/pages/Settings.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { updateService } from '../services/updateService';
import UpdateModal from '../components/UpdateModal';
import './Settings.css';

const Settings = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const [notifications, setNotifications] = useState(true);
  const [email, setEmail] = useState('');
  const [program, setProgram] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // In-app updater states
  const [versionInfo, setVersionInfo] = useState({ versionName: '...', versionCode: 0 });
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState(null);

  useEffect(() => {
    updateService.getInstalledVersion().then(setVersionInfo);
  }, []);

  // 1. Check Supabase Auth Session
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (isMounted) {
          if (session?.user) {
            setUser(session.user);
            setEmail(session.user.email || '');
          }
          setLoadingAuth(false);
        }
      } catch (err) {
        console.error('[Settings] Error checking session:', err);
        if (isMounted) setLoadingAuth(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        if (session?.user) {
          setUser(session.user);
          setEmail(session.user.email || '');
        } else {
          setUser(null);
        }
        setLoadingAuth(false);
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // 2. Load Profile Data from Supabase
  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('program')
          .eq('id', user.id)
          .maybeSingle();

        if (!error && data?.program) {
          setProgram(data.program);
        }
      } catch (err) {
        console.warn('[Settings] Failed to load profile:', err);
      }
    };
    fetchProfile();
  }, [user]);

  // Apply dark mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setIsSaving(true);
    setMessage({ text: '', type: '' });
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          program: program,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;
      setMessage({ text: '✅ Profile updated successfully!', type: 'success' });
    } catch (err) {
      console.error(err);
      setMessage({ text: '❌ Failed to update profile. Please try again.', type: 'error' });
    }
    setIsSaving(false);
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to log out?')) {
      try {
        await supabase.auth.signOut();
        navigate('/login');
      } catch (err) {
        console.error(err);
        alert('Logout failed. Please try again.');
      }
    }
  };

  const clearLocalData = () => {
    if (window.confirm('This will delete all your quiz history and local settings. Are you sure?')) {
      localStorage.removeItem('studyhub_stats');
      localStorage.removeItem('studyhub_quiz_state');
      localStorage.removeItem('theme');
      setMessage({ text: '✅ Local data cleared. Refresh to see changes.', type: 'success' });
      window.location.reload();
    }
  };

  const handleManualUpdateCheck = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatusText('');
    try {
      const res = await updateService.checkForUpdates({ forceCheck: true });
      if (res?.hasUpdate) {
        setAvailableUpdate(res.updateInfo);
        setModalOpen(true);
        setUpdateStatusText('');
      } else if (res?.error) {
        setUpdateStatusText(`⚠️ Unable to check updates: ${res.error}`);
      } else {
        setUpdateStatusText('✨ You are already on the latest version of StudyHub!');
      }
    } catch (err) {
      setUpdateStatusText(`⚠️ Check failed: ${err.message}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  if (loadingAuth) return <div className="settings-loading">Loading…</div>;
  if (!user) return <div className="settings-loading">Please log in to access settings.</div>;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="back-link" onClick={() => navigate(-1)}>
          <i className="fas fa-arrow-left"></i> Back
        </button>
        <h1><i className="fas fa-cog"></i> Settings</h1>
        <p className="text-muted">Manage your account and preferences</p>
      </div>

      {message.text && (
        <div className={`settings-message ${message.type}`}>{message.text}</div>
      )}

      <div className="settings-card">
        <h2>👤 Profile</h2>
        <div className="settings-group">
          <label>Email</label>
          <input type="email" value={email} disabled className="settings-input disabled" />
          <p className="field-note">Email associated with your StudyHub account.</p>
        </div>
        <div className="settings-group">
          <label>Program of Study</label>
          <input
            type="text"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            placeholder="e.g. Agricultural Economics"
            className="settings-input"
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSaveProfile}
          disabled={isSaving}
        >
          {isSaving ? 'Saving…' : 'Save Profile'}
        </button>
      </div>

      <div className="settings-card">
        <h2>🎨 Appearance</h2>
        <div className="settings-toggle">
          <span>Dark Mode</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={darkMode}
              onChange={() => setDarkMode(!darkMode)}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div className="settings-card">
        <h2>🔔 Notifications</h2>
        <div className="settings-toggle">
          <span>Push Notifications</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={notifications}
              onChange={() => setNotifications(!notifications)}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
        <p className="field-note">You can also manage notifications from your system settings.</p>
      </div>

      <div className="settings-card">
        <h2>🗑️ Data Management</h2>
        <button className="btn btn-danger" onClick={clearLocalData}>
          Clear All Local Data
        </button>
        <p className="field-note">This removes local cached quiz history and preferences from this device.</p>
      </div>

      <div className="settings-card">
        <h2>🚀 App Version & Updates</h2>
        <div className="settings-group" style={{ marginBottom: '12px' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '0.95rem', fontWeight: 600 }}>
            StudyHub LUANAR v{versionInfo.versionName}
          </p>
          <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0 }}>
            Build Code: {versionInfo.versionCode} • {updateService.isAndroid() ? 'Android Native Edition' : 'Web / Browser'}
          </p>
        </div>

        {updateStatusText && (
          <div style={{
            padding: '10px 14px',
            borderRadius: '10px',
            marginBottom: '12px',
            fontSize: '0.85rem',
            background: updateStatusText.includes('⚠️') ? '#fee2e2' : '#d1fae5',
            color: updateStatusText.includes('⚠️') ? '#991b1b' : '#065f46',
            fontWeight: 500,
          }}>
            {updateStatusText}
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleManualUpdateCheck}
          disabled={isCheckingUpdate}
        >
          <i className={`fas ${isCheckingUpdate ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`}></i>
          {' '}{isCheckingUpdate ? 'Checking for updates…' : 'Check for Updates'}
        </button>
        <p className="field-note" style={{ marginTop: '8px' }}>
          Checks directly with the official StudyHub release server for improvements and security fixes.
        </p>
      </div>

      <div className="settings-card">
        <h2>🔐 Account</h2>
        <button className="btn btn-danger" onClick={handleLogout}>
          <i className="fas fa-sign-out-alt"></i> Log Out
        </button>
      </div>

      <div className="settings-footer">
        <p className="text-muted">StudyHub v{versionInfo.versionName} • Made with ❤️ for LUANAR</p>
      </div>

      <UpdateModal
        isOpen={modalOpen}
        updateInfo={availableUpdate}
        currentVersion={versionInfo}
        onClose={() => setModalOpen(false)}
        onDismiss={() => setModalOpen(false)}
      />
    </div>
  );
};

export default Settings;