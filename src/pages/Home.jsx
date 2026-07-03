import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabase';
import { BottomNav } from '../components/BottomNav';
import { useNavigate, Navigate } from 'react-router-dom';   // ← added Navigate

// ========== Loading Skeleton ==========
const LoadingSkeleton = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {[1, 2, 3, 4, 5, 6].map((i) => (
      <div key={i} className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
        <div className="h-32 bg-muted"></div>
        <div className="p-3 space-y-2">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
          <div className="h-2 bg-muted rounded w-full"></div>
          <div className="flex justify-between">
            <div className="h-3 bg-muted rounded w-1/4"></div>
            <div className="h-3 bg-muted rounded w-1/4"></div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ========== Course Card ==========
const CourseCard = ({ file }) => {
  const fileUrl = file.url || (file.file_path ? 
    supabase.storage.from("notes").getPublicUrl(file.file_path).data.publicUrl : null);
  
  if (!fileUrl) return null;

  const title = file.title || file.filename || "Untitled File";
  const subject = file.subject || "Unknown Subject";
  const semester = file.semester || "N/A";
  const category = file.category || "General";
  const downloads = file.downloads || 0;
  const rating = file.rating ? file.rating.toFixed(1) : "N/A";

  let imageUrl;
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.endsWith(".pdf")) {
    imageUrl = "https://cdn-icons-png.flaticon.com/512/337/337946.png";
  } else if (lowerTitle.endsWith(".doc") || lowerTitle.endsWith(".docx")) {
    imageUrl = "https://cdn-icons-png.flaticon.com/512/337/337932.png";
  } else if (lowerTitle.endsWith(".ppt") || lowerTitle.endsWith(".pptx")) {
    imageUrl = "https://cdn-icons-png.flaticon.com/512/337/337951.png";
  } else {
    imageUrl = `https://source.unsplash.com/400x300/?${encodeURIComponent(title)}`;
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-200 hover:-translate-y-1 group">
      <div className="relative h-32 overflow-hidden">
        <img 
          src={imageUrl} 
          alt={title} 
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
        <div className="absolute top-2 left-2">
          <span className="px-2 py-0.5 bg-background/90 backdrop-blur-sm text-xs font-medium rounded-md text-foreground/80">
            {category}
          </span>
        </div>
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
          <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </div>
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-medium text-sm mb-0.5 text-foreground group-hover:text-blue-600 transition-colors line-clamp-2">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground mb-1">Subject: {subject}</p>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>Semester {semester}</span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <svg className="w-3 h-3 text-yellow-500" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
              </svg>
              <span className="text-foreground">{rating}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span className="text-foreground">{downloads}</span>
            </div>
          </div>
        </div>
        <button 
          onClick={() => window.open(fileUrl, '_blank')}
          className="w-full mt-1 px-3 py-1.5 text-xs bg-transparent border border-border rounded-lg hover:bg-accent transition-colors text-foreground"
        >
          Open File
        </button>
      </div>
    </div>
  );
};

// ========== Stats Card ==========
const StatsCard = ({ icon, title, value, subtitle, gradient }) => (
  <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-3 hover:shadow-lg transition-all duration-200 hover:-translate-y-1">
    <div className="flex items-center justify-between mb-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className={`p-1.5 rounded-lg bg-gradient-to-br ${gradient} shadow-lg`}>
        {icon}
      </div>
    </div>
    <div className="text-xl font-bold text-foreground">{value}</div>
    {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
  </div>
);

// ========== Home Component ==========
const Home = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState(0);
  const [daysLeft, setDaysLeft] = useState(0);
  const [daysDelta, setDaysDelta] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollContainerRef = useRef(null);
  const authSubscriptionRef = useRef(null);

  const [sessionLoading, setSessionLoading] = useState(true);
  const [showInstallButton, setShowInstallButton] = useState(false);

  // Install button
  useEffect(() => {
    if (
      localStorage.getItem('studyhub_installed') === 'true' ||
      window.matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone
    ) return;
    const timer = setTimeout(() => setShowInstallButton(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  // Exam countdown
  const calculateExamCountdown = useCallback(() => {
    const examDate = new Date(2026, 5, 17);
    const now = new Date();
    const diffDays = Math.ceil((examDate - now) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      setDaysLeft(diffDays);
      setDaysDelta('days left until exams');
    } else if (diffDays === 0) {
      setDaysLeft(0);
      setDaysDelta('Exams start today!');
    } else {
      setDaysLeft(0);
      setDaysDelta('Exams are over');
    }
  }, []);

  // Load files
  const loadFiles = useCallback(async (program) => {
    if (!program) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("files")
        .select("*")
        .ilike("program", program.trim())
        .order("uploaded_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      setFiles(data || []);
    } catch (err) {
      console.error("loadFiles error:", err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load user profile
  const loadUserProfile = useCallback(async (authUser) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();
      if (error) throw error;
      if (!profile) {
        // Profile missing → let the Login page handle profile completion
        navigate('/login', { replace: true });
        return;
      }
      setUserData({
        displayName: authUser.user_metadata?.full_name || authUser.email,
        email: authUser.email,
        program: profile.program,
        semester: profile.semester,
      });
      if (profile.program) {
        loadFiles(profile.program);
      }
      // Streak logic
      const today = new Date().toDateString();
      const lastActive = profile.last_active ? new Date(profile.last_active).toDateString() : null;
      let newStreak = profile.streak || 0;
      if (lastActive === today) {
        // unchanged
      } else if (lastActive === new Date(Date.now() - 86400000).toDateString()) {
        newStreak += 1;
      } else {
        newStreak = 1;
      }
      await supabase
        .from('profiles')
        .upsert({ id: authUser.id, streak: newStreak, last_active: new Date().toISOString() });
      setStreak(newStreak);
      calculateExamCountdown();
    } catch (err) {
      console.error('Error loading profile:', err);
      navigate('/login', { replace: true });
    }
  }, [loadFiles, calculateExamCountdown, navigate]);

  // --- Session listener (no premature redirect) ---
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          await loadUserProfile(session.user);
        } else if (event === 'SIGNED_OUT') {
          // Only redirect on explicit sign-out, not on transient nulls
          setUser(null);
          setUserData(null);
        }
        // For any other event (e.g., INITIAL_SESSION with null session)
        // we let the render logic decide based on user state
        setSessionLoading(false);
      }
    );
    authSubscriptionRef.current = subscription;
    return () => {
      if (authSubscriptionRef.current) authSubscriptionRef.current.unsubscribe();
    };
  }, [loadUserProfile]);  // removed navigate from deps to avoid loop

  // Scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => setIsScrolled(container.scrollTop > 50);
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Filter files
  const filteredFiles = files.filter(file => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const title = (file.title || file.filename || '').toLowerCase();
    const subject = (file.subject || '').toLowerCase();
    return title.includes(query) || subject.includes(query);
  });

  const displayName = user?.email?.split('@')[0] || userData?.displayName || 'User';
  const names = displayName.trim().split(' ');
  const initials = names.length === 1 
    ? names[0][0] 
    : names[0][0] + names[names.length - 1][0];

  const handleNavigation = (path) => navigate(path);

  // --- Loading spinner ---
  if (sessionLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm text-gray-500">Loading your account…</p>
        </div>
      </div>
    );
  }

  // If no user after session check, redirect to login (replaces previous aggressive listener redirect)
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // ==================== MAIN LOGGED‑IN VIEW ====================
  return (
    <div 
      ref={scrollContainerRef}
      className="h-screen overflow-y-auto overflow-x-hidden bg-gradient-to-br from-blue-50 to-purple-50 pb-16 lg:pb-0 w-full max-w-full"
    >
      {/* ===== MOBILE HEADER ===== */}
      <div className="lg:hidden sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border">
        <div className="flex items-center justify-between py-3 px-4">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 -ml-2 hover:bg-accent rounded-md transition-colors"
              aria-label="Toggle menu"
            >
              <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" x2="20" y1="6" y2="6"/>
                <line x1="4" x2="20" y1="12" y2="12"/>
                <line x1="4" x2="20" y1="18" y2="18"/>
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center overflow-hidden">
                <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" />
              </div>
              <h1 className="text-lg font-medium">
                <span className="text-black">StudyHub</span>
                <span className="text-green-700"> LUANAR</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => handleNavigation('/profile')}
              className="flex flex-col items-center p-2 -mr-2"
            >
              <img 
                src={localStorage.getItem('userProfilePic') || "https://cdn-icons-png.flaticon.com/512/847/847969.png"}
                alt="Profile" 
                className="w-8 h-8 rounded-full border-2 border-blue-500 shadow-sm transition-transform duration-300 hover:scale-110"
              />
              <span className="text-xs font-semibold text-blue-500 mt-0.5">You</span>
            </button>
          </div>
        </div>
        
        {/* Mobile Welcome Banner – disappears on scroll */}
        <div 
          className={`p-3 bg-gradient-to-br from-blue-50/80 to-purple-50/80 transition-all duration-300 ${
            isScrolled ? 'opacity-0 max-h-0 p-0 overflow-hidden' : 'opacity-100 max-h-20 p-3'
          }`}
        >
          <div className="text-center space-y-1">
            <h2 className="text-sm font-light text-foreground">Welcome back, {displayName}</h2>
            <p className="text-xs text-muted-foreground">Continue your learning journey</p>
          </div>
        </div>
      </div>

      {/* ===== DESKTOP HEADER ===== */}
      <div className="hidden lg:block px-6 py-6 space-y-4">
        <div className="text-left space-y-1">
          <h1 className="text-2xl font-light text-foreground">
            Welcome back, <span className="font-medium">{displayName}</span>
          </h1>
          <p className="text-sm text-muted-foreground">Continue your learning journey and achieve your goals 🚀</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <input 
              type="text" 
              placeholder="Search courses, instructors, or topics..." 
              className="w-full pl-10 pr-4 py-2.5 bg-card/50 backdrop-blur-sm border border-border/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-foreground placeholder:text-muted-foreground text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-card/50 backdrop-blur-sm border border-border/50 rounded-lg hover:bg-accent transition-all text-foreground text-sm">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/>
            </svg>
            Filter
          </button>
        </div>
      </div>

      {/* ===== MAIN CONTENT ===== */}
      <div className="px-4 lg:px-6 space-y-4 lg:space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 lg:gap-4">
          <StatsCard
            icon={
              <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20l-5.5-6-5.5 6V2Z"/>
              </svg>
            }
            title="Days Until Exams"
            value={daysLeft}
            subtitle={daysDelta}
            gradient="from-blue-500 to-cyan-500"
          />
          <StatsCard
            icon={
              <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
              </svg>
            }
            title="Learning Streak"
            value={`${streak} days`}
            gradient="from-orange-500 to-red-500"
          />
        </div>

        {/* Course Grid */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-medium text-foreground">Recently uploaded</h2>
              <button 
                onClick={() => handleNavigation('/my_courses')}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                View All
              </button>
            </div>
            {loading ? (
              <LoadingSkeleton />
            ) : filteredFiles.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredFiles.map((file, index) => (
                  <CourseCard key={file.id || index} file={file} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">
                  {files.length === 0 
                    ? 'No courses available for your program yet.' 
                    : `No courses match "${searchQuery}".`}
                </p>
                {files.length === 0 && (
                  <button 
                    onClick={() => handleNavigation('/request')}
                    className="mt-2 text-sm text-blue-600 hover:underline"
                  >
                    Request notes
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Navigation */}
      <BottomNav />

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <div className={`
        lg:hidden fixed top-0 left-0 h-full w-64 bg-white border-r border-border
        transform transition-transform duration-300 ease-in-out z-50 flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex justify-end p-4">
          <button 
            onClick={() => setSidebarOpen(false)}
            className="p-2 hover:bg-accent rounded-md transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m18 6-12 12"/>
              <path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
        <div className="px-6 pb-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted border border-border shadow-sm">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-medium ring-2 ring-white/30">
              {initials.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">Student</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-6">
          <ul className="space-y-2">
            <li>
              <button 
                onClick={() => { handleNavigation('/upload'); setSidebarOpen(false); }}
                className="nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg hover:from-blue-600 hover:to-purple-700 transition-all text-left"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9,22 9,12 15,12 15,22"/>
                </svg>
                Upload Notes
              </button>
            </li>
            <li>
              <button 
                onClick={() => { handleNavigation('/course'); setSidebarOpen(false); }}
                className="nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-all text-left text-foreground/80"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                  <path d="M6.5 2H20v20l-5.5-6-5.5 6V2Z"/>
                </svg>
                My Courses
              </button>
            </li>
            <li>
              <button 
                onClick={() => { handleNavigation('/timetable'); setSidebarOpen(false); }}
                className="nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-all text-left text-foreground/80"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Timetable
              </button>
            </li>
            <li>
              <button 
                onClick={() => { handleNavigation('/request'); setSidebarOpen(false); }}
                className="nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-all text-left text-foreground/80"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="7"/>
                  <polyline points="8.21,13.89 7,23 12,20 17,23 15.79,13.88"/>
                </svg>
                Request Notes
              </button>
            </li>
            <li>
              <button 
                onClick={() => { handleNavigation('/profile'); setSidebarOpen(false); }}
                className="nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-all text-left text-foreground/80"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                Profile
              </button>
            </li>
            <li>
              <button 
                onClick={() => { handleNavigation('/settings'); setSidebarOpen(false); }}
                className="nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-all text-left text-foreground/80"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15-.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                Settings
              </button>
            </li>
          </ul>
        </nav>
        <div className="p-6">
          <div className="h-px bg-border mb-4"></div>
          <div className="text-xs text-muted-foreground text-center">
            © 2024 EduApp. All rights reserved.
          </div>
        </div>
      </div>

      {/* ========== INSTALL BUTTON ========== */}
      {showInstallButton && (
        <button
          onClick={async () => {
            const installEvent = window.__INSTALL_EVENT__;
            if (installEvent) {
              installEvent.prompt();
              const { outcome } = await installEvent.userChoice;
              if (outcome === 'accepted') {
                localStorage.setItem('studyhub_installed', 'true');
                setShowInstallButton(false);
              }
            } else {
              alert('Tap the browser menu (⋮) → "Add to Home screen"');
            }
          }}
          className="fixed bottom-20 right-4 z-50 
                     flex items-center gap-1.5 px-3 py-1.5 
                     bg-white/80 backdrop-blur-sm border border-gray-300 
                     rounded-full shadow-sm hover:shadow-md 
                     text-xs font-medium text-gray-600 hover:text-gray-800 
                     transition-all duration-200 active:scale-95"
          aria-label="Install App"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12l7 7 7-7M21 21H3"/>
          </svg>
          <span>Install App</span>
        </button>
      )}
    </div>
  );
};

export default Home;