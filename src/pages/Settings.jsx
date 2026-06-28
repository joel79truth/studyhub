import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthState } from 'react-firebase-hooks/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import './Settings.css';

const Settings = () => {
  const navigate = useNavigate();
  const [user, loadingAuth] = useAuthState(auth);
  const [userData, setUserData] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const [notifications, setNotifications] = useState(true);
  const [email, setEmail] = useState('');
  const [program, setProgram] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Load user data
  useEffect(() => {
    if (!user) return;
    const fetchUser = async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const data = snap.data();
        setUserData(data);
        setEmail(user.email || '');
        setProgram(data.program || '');
      }
    };
    fetchUser();
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
      await updateDoc(doc(db, 'users', user.uid), {
        program: program,
        updatedAt: new Date().toISOString(),
      });
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
        await signOut(auth);
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
      // Reload stats if needed – we'll just navigate away and back
      window.location.reload();
    }
  };

  if (loadingAuth) return <div className="settings-loading">Loading…</div>;
  if (!user) return <div className="settings-loading">Please log in.</div>;

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
          <p className="field-note">Email cannot be changed here. Update via Firebase.</p>
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
        <p className="field-note">You can also manage notifications from your browser settings.</p>
      </div>

      <div className="settings-card">
        <h2>🗑️ Data Management</h2>
        <button className="btn btn-danger" onClick={clearLocalData}>
          Clear All Local Data
        </button>
        <p className="field-note">This removes your quiz history and preferences from this device.</p>
      </div>

      <div className="settings-card">
        <h2>🔐 Account</h2>
        <button className="btn btn-danger" onClick={handleLogout}>
          <i className="fas fa-sign-out-alt"></i> Log Out
        </button>
      </div>

      <div className="settings-footer">
        <p className="text-muted">StudyHub v1.0 • Made with ❤️ for LUANAR</p>
      </div>
    </div>
  );
};

export default Settings;