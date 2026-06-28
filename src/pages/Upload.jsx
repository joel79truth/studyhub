import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import styles from './Upload.module.css';

export default function Upload() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // ── Form state ──
  const [programs, setPrograms] = useState([]);
  const [programInput, setProgramInput] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [semester, setSemester] = useState('');
  const [subject, setSubject] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [apiFailed, setApiFailed] = useState(false);

  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const dragCounter = useRef(0);

  // ── Check Supabase session ──
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        navigate('/login');
        return;
      }
      setUser(session.user);
      setLoading(false);
    };
    checkSession();

    // Auth listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          setUser(session.user);
        } else {
          navigate('/login');
        }
      }
    );
    return () => subscription?.unsubscribe();
  }, [navigate]);

  // ── Load programs ──
  useEffect(() => {
    if (!user) return;
    const loadPrograms = async () => {
      try {
        // If you have a Supabase programs table, query it directly:
        const { data, error } = await supabase
          .from('programs')
          .select('name')
          .order('name');
        if (error) throw error;
        const list = data.map(p => p.name);
        setPrograms(list);
        setApiFailed(false);
      } catch (err) {
        console.error('Failed to load programs:', err);
        setApiFailed(true);
        addToast('Programs API error', 'Using manual entry. Please type your program.', 'error');
      }
    };
    loadPrograms();
  }, [user]);

  // ── Toast system ──
  const addToast = (title, message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2800);
  };

  // ── Filtered programs for dropdown ──
  const filteredPrograms = programs.filter(p =>
    p.toLowerCase().includes(programInput.toLowerCase())
  );

  // ── File handling ──
  const handleFile = (file) => {
    const allowed = /\.(pdf|pptx)$/i;
    if (!allowed.test(file.name)) {
      addToast('Invalid file type', 'Only PDF or PPTX files are allowed.', 'error');
      return false;
    }
    if (file.size > 50 * 1024 * 1024) {
      addToast('File too large', 'Maximum size is 50MB.', 'error');
      return false;
    }
    if (file.size > 20 * 1024 * 1024) {
      addToast('Large file warning', 'Files >20MB may cause memory issues on phones. Consider compressing.', 'error');
    }
    setFile(file);
    setFileError('');
    return true;
  };

  const removeFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Form validation ──
  const isFormValid = programInput.trim() !== '' && semester !== '' && subject.trim() !== '' && file !== null;

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user || !file || !isFormValid) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('program', programInput.trim());
    formData.append('semester', semester);
    formData.append('subject', subject.trim());

    try {
      // Use Supabase session access token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        throw new Error('No access token');
      }

      setUploading(true);
      setUploadProgress(0);

      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 5, 90));
      }, 100);

      const res = await fetch('/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (res.ok) {
        addToast('Upload successful!', `${file.name} has been shared.`, 'success');
        // Reset form
        setProgramInput('');
        setSemester('');
        setSubject('');
        removeFile();
      } else {
        const errText = await res.text();
        throw new Error(errText || 'Upload failed');
      }
    } catch (err) {
      console.error(err);
      addToast('Upload failed', err.message || 'Please try again later.', 'error');
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 500);
    }
  };

  // ── Click outside dropdown ──
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Drag and drop ──
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      document.getElementById('dropzone').classList.add(styles.dragActive);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      document.getElementById('dropzone').classList.remove(styles.dragActive);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    document.getElementById('dropzone').classList.remove(styles.dragActive);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  // ── Render ──
  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!user) return null;   // will redirect via useEffect

  return (
    <div className={styles.page}>
      {/* Top Navigation */}
      <nav className={styles.topNav}>
        <div className={styles.navLeft}>
          <button className={styles.navBackBtn} onClick={() => navigate(-1)} aria-label="Go back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className={styles.logo}>
            <div className={styles.logoImg}>
              <img
                src="/images/luanar7.png"
                alt="LUANAR"
                onError={(e) => {
                  e.target.src = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22%232563eb%22%2F%3E%3Ctext%20x%3D%2216%22%20y%3D%2222%22%20text-anchor%3D%22middle%22%20fill%3D%22white%22%20font-size%3D%2216%22%3E📘%3C%2Ftext%3E%3C%2Fsvg%3E";
                }}
              />
            </div>
            <div className={styles.logoText}>
              <span>StudyHub</span><span> LUANAR</span>
            </div>
          </div>
        </div>
        <button className={styles.navProfile} onClick={() => navigate('/profile')} aria-label="Profile">
          <img
            id="profilePicThumb"
            src={user?.user_metadata?.avatar_url || 'https://www.w3schools.com/howto/img_avatar.png'}
            alt="Profile"
          />
        </button>
      </nav>

      {/* Toast Container */}
      <div className={styles.toastContainer}>
        {toasts.map(({ id, title, message, type }) => (
          <div key={id} className={`${styles.toast} ${styles[`toast${type.charAt(0).toUpperCase() + type.slice(1)}`]}`}>
            <span>{type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
            <div>
              <strong>{title}</strong>
              {message && (<>
                <br />
                <small>{message}</small>
              </>)}
            </div>
          </div>
        ))}
      </div>

      {/* Main */}
      <main className={styles.mainContainer}>
        <div className={styles.uploadCard}>
          <div className={styles.iconHeader}>
            <div className={styles.iconCircle}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <h2>Upload Notes</h2>
            <p className={styles.subhead}>Share your academic resources</p>
          </div>

          <div className={styles.userBar}>
            <div className={styles.userIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div className={styles.userInfo}>
              <div className={styles.userLabel}>Logged in as</div>
              <div className={styles.userEmail}>{user?.email || 'student@luanar.ac.mw'}</div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Program */}
            <div className={styles.formGroup}>
              <label>Program</label>
              <div ref={dropdownRef} className={styles.programSearchWrapper}>
                <input
                  type="text"
                  className={styles.programInput}
                  placeholder="Type to search program..."
                  value={programInput}
                  onChange={(e) => {
                    setProgramInput(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  required
                />
                {!apiFailed && programs.length > 0 && showDropdown && (
                  <div className={styles.programDropdown}>
                    {filteredPrograms.length === 0 ? (
                      <div className={styles.programOption} style={{ color: '#94a3b8' }}>
                        No matching programs
                      </div>
                    ) : (
                      filteredPrograms.map((p) => (
                        <div
                          key={p}
                          className={styles.programOption}
                          onClick={() => {
                            setProgramInput(p);
                            setShowDropdown(false);
                          }}
                        >
                          {p}
                        </div>
                      ))
                    )}
                  </div>
                )}
                {apiFailed && (
                  <div className={styles.fallbackNote}>
                    ⚠️ Program list not available. Please type your program manually.
                  </div>
                )}
              </div>
            </div>

            {/* Semester */}
            <div className={styles.formGroup}>
              <label>Semester</label>
              <select
                className={styles.select}
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                required
              >
                <option value="" disabled>Select semester</option>
                {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            {/* Subject */}
            <div className={styles.formGroup}>
              <label>Subject / Course Name</label>
              <input
                type="text"
                className={styles.input}
                placeholder="e.g., Advanced Soil Science"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>

            {/* File dropzone */}
            <div className={styles.formGroup}>
              <label>File (PDF or PPTX, max 50MB)</label>
              <div
                id="dropzone"
                className={`${styles.dropzone} ${file ? styles.hasFile : ''}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !file && fileInputRef.current?.click()}
              >
                {!file ? (
                  <div className={styles.dropzoneEmpty}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <p><span className={styles.textBlue}>Click to upload</span> or drag & drop</p>
                    <p className={styles.smallText}>PDF or PPTX only</p>
                  </div>
                ) : (
                  <div className={styles.dropzoneFilled}>
                    <div className={styles.fileIcon}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                        <polyline points="13 2 13 9 20 9" />
                      </svg>
                    </div>
                    <div className={styles.fileDetails}>
                      <div className={styles.fileName}>{file.name}</div>
                      <div className={styles.fileSize}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    <button type="button" className={styles.removeFile} onClick={removeFile} aria-label="Remove file">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              <input
                type="file"
                ref={fileInputRef}
                accept=".pdf,.pptx"
                className={styles.hidden}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFile(e.target.files[0]);
                  }
                }}
              />
            </div>

            {/* Buttons */}
            <div className={styles.buttonGroup}>
              <button
                type="button"
                className={styles.btnHome}
                onClick={() => navigate('/')}
                title="Home"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-5v-8H7v8H2a2 2 0 0 1-2-2z" />
                </svg>
              </button>
              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={!isFormValid || uploading}
              >
                {uploading ? (
                  <>
                    <span>⏳ Uploading...</span>
                    <div className={styles.progressOverlay} style={{ width: `${uploadProgress}%` }} />
                  </>
                ) : (
                  <span>📤 Upload Notes</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}