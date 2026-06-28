import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [profile, setProfile] = useState(null);
  const [files, setFiles] = useState([]);
  const [connections, setConnections] = useState(0);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    campus: '',
    bio: ''
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ message: '', type: '' });

  // Check Supabase session
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        navigate('/login');
        return;
      }
      setUser(session.user);
      setLoadingAuth(false);
    };
    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) setUser(session.user);
        else navigate('/login');
      }
    );
    return () => subscription?.unsubscribe();
  }, [navigate]);

  // Load profile from Supabase 'profiles' table
  useEffect(() => {
    if (!user) return;

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading profile:', error);
        return;
      }

      const profileData = data || {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
        program: '',
        semester: null,
        campus: '',
        bio: '',
        subjects: [],
        profile_pic: user.user_metadata?.avatar_url || '',
        updated_at: new Date().toISOString()
      };
      setProfile(profileData);

      // Load user's uploaded files (if table exists)
      const { data: filesData } = await supabase
        .from('user_files')
        .select('*')
        .eq('user_id', user.id)
        .order('uploaded_at', { ascending: false });

      setFiles(filesData || []);

      const connectionsCount = localStorage.getItem(`connections_${user.id}`) || 0;
      setConnections(Number(connectionsCount));
    };

    loadProfile();
  }, [user]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type: '' }), 3000);
  };

  const calculateStrength = () => {
    if (!profile) return 0;
    let score = 0;
    if (profile.name) score++;
    if (profile.email) score++;
    if (profile.profile_pic) score++;
    if (profile.bio?.trim()) score++;
    if (profile.campus) score++;
    return (score / 5) * 100;
  };

  const handlePictureUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image too large (max 5MB)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      const { error } = await supabase
        .from('profiles')
        .update({ profile_pic: base64, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) {
        showToast('Failed to update profile picture', 'error');
      } else {
        setProfile({ ...profile, profile_pic: base64 });
        try {
          await supabase.auth.updateUser({ data: { avatar_url: base64 } });
        } catch (err) {}
        showToast('Profile picture updated!');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleEditClick = () => {
    setFormData({
      name: profile.name || '',
      email: profile.email || '',
      campus: profile.campus || '',
      bio: profile.bio || ''
    });
    setEditing(true);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    try {
      const updates = {};
      if (formData.name !== user.user_metadata?.full_name) {
        updates.data = { ...user.user_metadata, full_name: formData.name };
      }
      if (formData.email !== user.email) {
        updates.email = formData.email;
      }
      if (Object.keys(updates).length > 0) {
        const { error: authError } = await supabase.auth.updateUser(updates);
        if (authError) throw authError;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          name: formData.name,
          email: formData.email,
          campus: formData.campus,
          bio: formData.bio,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);
      if (error) throw error;

      setProfile({
        ...profile,
        name: formData.name,
        email: formData.email,
        campus: formData.campus,
        bio: formData.bio
      });
      setEditing(false);
      showToast('Profile updated successfully!');
    } catch (err) {
      console.error(err);
      showToast('Update failed: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addSubject = async () => {
    const newSubject = window.prompt('Enter a subject (e.g., Soil Science):');
    if (!newSubject?.trim()) return;
    const trimmed = newSubject.trim();
    const currentSubjects = profile.subjects || [];
    if (currentSubjects.includes(trimmed)) {
      showToast('Subject already exists', 'error');
      return;
    }
    const updated = [...currentSubjects, trimmed];
    const { error } = await supabase
      .from('profiles')
      .update({ subjects: updated, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) {
      showToast('Failed to add subject', 'error');
    } else {
      setProfile({ ...profile, subjects: updated });
      showToast(`"${trimmed}" added!`);
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Sign out of StudyHub?')) {
      await supabase.auth.signOut();
      navigate('/login');
    }
  };

  if (loadingAuth) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading profile...</div>;
  if (!user) return null;

  const strength = calculateStrength();
  const joinedDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '0 16px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* ========== TOP HEADER ========== */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 30,
        backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 0', marginBottom: '12px'
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '0.9rem', color: '#2563eb'
          }}
          aria-label="Go back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
          {profile?.campus ? `${profile.campus} Campus` : 'LUANAR'}
        </div>
        <div style={{ width: '60px' }} /> {/* spacer for symmetry */}
      </div>

      {/* Toast */}
      {toast.message && (
        <div style={{
          position: 'fixed', top: '70px', right: '16px', zIndex: 2000,
          background: 'white', borderLeft: `3px solid ${toast.type === 'error' ? '#ef4444' : '#10b981'}`,
          padding: '8px 16px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          {toast.message}
        </div>
      )}

      {/* Welcome Banner */}
      <div style={{
        background: '#ecfdf5', borderLeft: '3px solid #1e4620', borderRadius: '16px',
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px'
      }}>
        <div style={{ width: '44px', height: '44px', background: 'white', borderRadius: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <img src="/images/luanar7.png" alt="LUANAR" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => e.target.src = 'https://via.placeholder.com/44?text=LUANAR'} />
        </div>
        <div>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>LUANAR • {profile?.campus || 'Bunda Campus'}</h2>
          <p style={{ fontSize: '0.7rem', margin: 0, color: '#166534' }}>Empowering agricultural minds</p>
        </div>
        <div style={{ fontSize: '0.7rem', background: 'rgba(30,70,32,0.1)', padding: '4px 12px', borderRadius: '30px', marginLeft: 'auto' }}>🎓 #ProudlyLUANAR</div>
      </div>

      {/* Profile Card */}
      <div style={{
        position: 'relative',
        background: 'white', borderRadius: '20px', padding: '20px', textAlign: 'center',
        border: '1px solid #e2e8f0', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)', marginBottom: '16px'
      }}>
        {/* Edit Icon Button – small, top-right */}
        <button
          onClick={handleEditClick}
          title="Edit profile"
          style={{
            position: 'absolute', top: '12px', right: '12px',
            background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '50%',
            width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>

        <div style={{ width: '80px', height: '80px', margin: '0 auto 12px', position: 'relative', cursor: 'pointer' }} onClick={() => document.getElementById('profilePicUpload').click()}>
          <img
            src={profile?.profile_pic || user.user_metadata?.avatar_url || 'https://www.w3schools.com/howto/img_avatar.png'}
            alt="profile"
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', border: '2px solid white', boxShadow: '0 0 0 2px #3b82f6' }}
          />
          <div style={{ position: 'absolute', bottom: '-8px', left: '50%', transform: 'translateX(-50%)', background: 'white', fontSize: '10px', padding: '2px 10px', borderRadius: '20px', border: '1px solid #cbd5e1' }}>📷</div>
        </div>
        <input type="file" id="profilePicUpload" accept="image/*" style={{ display: 'none' }} onChange={handlePictureUpload} />

        <div style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '4px' }}>
          {profile?.name || user.user_metadata?.full_name || 'LUANAR Student'}
        </div>

        {/* Program display */}
        {profile?.program && (
          <div style={{ fontSize: '0.8rem', color: '#1e4620', fontWeight: 600, marginBottom: '4px' }}>
            📘 {profile.program} {profile.semester ? `(Semester ${profile.semester})` : ''}
          </div>
        )}

        <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '8px' }}>{profile?.email || user.email}</div>
        <div style={{ fontSize: '0.8rem', color: '#334155', margin: '0 auto 12px', maxWidth: '90%' }}>
          {profile?.bio || 'Set your bio and campus to complete your profile.'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', margin: '12px 0' }}>
          <div style={{ width: '120px', height: '5px', background: '#e2e8f0', borderRadius: '5px', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'linear-gradient(135deg, #059669, #10b981)', width: `${strength}%` }}></div>
          </div>
          <span style={{ fontSize: '0.7rem' }}>{Math.round(strength)}% complete</span>
        </div>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
        <div style={{ background: 'white', borderRadius: '16px', padding: '12px 8px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '20px' }}>📁</div>
          <div style={{ fontSize: '1rem', fontWeight: 800 }}>{files.length}</div>
          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Notes</div>
        </div>
        <div style={{ background: 'white', borderRadius: '16px', padding: '12px 8px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '20px' }}>🤝</div>
          <div style={{ fontSize: '1rem', fontWeight: 800 }}>{connections}</div>
          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Connections</div>
        </div>
        <div style={{ background: 'white', borderRadius: '16px', padding: '12px 8px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '20px' }}>📅</div>
          <div style={{ fontSize: '1rem', fontWeight: 800 }}>{joinedDate}</div>
          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Joined</div>
        </div>
      </div>

      {/* Subjects Tags */}
      <div style={{ background: 'white', borderRadius: '20px', padding: '18px 20px', textAlign: 'center', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
          {(profile?.subjects || []).map((subj, idx) => (
            <span key={idx} style={{ background: '#f1f5f9', padding: '4px 12px', borderRadius: '30px', fontSize: '0.7rem' }}>📖 {subj}</span>
          ))}
          <span onClick={addSubject} style={{ background: '#f1f5f9', padding: '4px 12px', borderRadius: '30px', fontSize: '0.7rem', cursor: 'pointer' }}>➕ Add Subject</span>
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <form onSubmit={handleSaveProfile} style={{ background: 'white', borderRadius: '20px', padding: '18px 20px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '4px' }}>Full Name</label>
            <input type="text" name="name" value={formData.name} onChange={handleInputChange} style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.8rem' }} />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '4px' }}>Email</label>
            <input type="email" name="email" value={formData.email} onChange={handleInputChange} style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.8rem' }} />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '4px' }}>Campus</label>
            <select name="campus" value={formData.campus} onChange={handleInputChange} style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.8rem' }}>
              <option value="">-- Select Campus --</option>
              <option value="NRC">🌍 NRC Campus (Lilongwe)</option>
              <option value="Bunda">🌾 Bunda Campus</option>
              <option value="City">🏙️ City Campus</option>
            </select>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '4px' }}>Short Bio</label>
            <textarea name="bio" rows="2" maxLength="120" value={formData.bio} onChange={handleInputChange} style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.8rem' }}></textarea>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button type="submit" disabled={saving} style={{ flex: 1, padding: '8px', borderRadius: '30px', fontWeight: 600, cursor: 'pointer', background: 'linear-gradient(135deg, #059669, #10b981)', color: 'white', border: 'none' }}>{saving ? 'Saving...' : '💾 Save'}</button>
            <button type="button" onClick={() => setEditing(false)} style={{ flex: 1, padding: '8px', borderRadius: '30px', fontWeight: 600, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #cbd5e1' }}>Cancel</button>
          </div>
        </form>
      )}

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '16px' }}>
        <div onClick={() => navigate('/upload')} style={{ background: 'white', borderRadius: '16px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
          <div style={{ width: '36px', height: '36px', background: '#f1f5f9', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📤</div>
          <div><div style={{ fontWeight: 700, fontSize: '0.8rem' }}>Upload Notes</div><div style={{ fontSize: '0.7rem', color: '#64748b' }}>Share your knowledge</div></div>
        </div>
        <div onClick={() => navigate('/videolesson')} style={{ background: 'white', borderRadius: '16px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
          <div style={{ width: '36px', height: '36px', background: '#f1f5f9', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▶️</div>
          <div><div style={{ fontWeight: 700, fontSize: '0.8rem' }}>Video Lessons</div><div style={{ fontSize: '0.7rem', color: '#64748b' }}>Watch tutorials</div></div>
        </div>
        <div onClick={() => navigate('/wisdom')} style={{ background: 'white', borderRadius: '16px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
          <div style={{ width: '36px', height: '36px', background: '#f1f5f9', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💡</div>
          <div><div style={{ fontWeight: 700, fontSize: '0.8rem' }}>Wisdom</div><div style={{ fontSize: '0.7rem', color: '#64748b' }}>Daily inspiration</div></div>
        </div>
        <div onClick={() => navigate('/friend-requests')} style={{ background: 'white', borderRadius: '16px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
          <div style={{ width: '36px', height: '36px', background: '#f1f5f9', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>👥</div>
          <div><div style={{ fontWeight: 700, fontSize: '0.8rem' }}>Friend Requests</div><div style={{ fontSize: '0.7rem', color: '#64748b' }}>Connect with peers</div></div>
        </div>
      </div>

      {/* My Files */}
      <div style={{ background: 'white', borderRadius: '20px', padding: '18px 20px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontWeight: 700 }}>📁 My Uploads</span>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{files.length} files</span>
        </div>
        <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>📭 No notes uploaded yet.</div>
          ) : (
            files.map(file => (
              <div key={file.id} style={{ background: '#fefce8', borderRadius: '10px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ width: '32px', height: '32px', background: '#e2e8f0', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {file.name?.endsWith('.pdf') ? '📕' : '📄'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>{file.name}</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{file.subject || 'General'}</div>
                </div>
                <a href={file.url} target="_blank" rel="noopener noreferrer" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '4px 12px', borderRadius: '20px', fontSize: '0.7rem', textDecoration: 'none', color: '#0f172a' }}>View</a>
              </div>
            ))
          )}
        </div>
      </div>

      <button onClick={handleLogout} style={{ width: '100%', background: '#fff1f0', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px', borderRadius: '40px', fontWeight: 600, cursor: 'pointer' }}>🚪 Sign Out</button>
    </div>
  );
}