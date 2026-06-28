import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from "../components/BottomNav";

const normalizeName = (name) => name.trim().toLowerCase();

// Merge similar program names
const mergeSimilarPrograms = (files) => {
  const mergedCounts = {};
  files.forEach((f) => {
    if (!f.program) return;
    const cleaned = f.program
      .toLowerCase()
      .replace(/\b(in|of|and|the|at|on|for|by|to)\b/g, '')
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const existingKey = Object.keys(mergedCounts).find((k) => {
      const kClean = k
        .toLowerCase()
        .replace(/\b(in|of|and|the|at|on|for|by|to)\b/g, '')
        .replace(/[^a-z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return kClean === cleaned;
    });
    if (existingKey) mergedCounts[existingKey]++;
    else mergedCounts[f.program.trim()] = 1;
  });
  return mergedCounts;
};

export default function Programs() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
  const [programCounts, setProgramCounts] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const debounceTimer = useRef(null);

  // ── Load programs ──
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/metadata');
        const data = await res.json();
        const files = Array.isArray(data) ? data : data.files || [];
        const counts = mergeSimilarPrograms(files);
        setProgramCounts(counts);
        setPrograms(Object.keys(counts));
      } catch (err) {
        console.error('Failed to load programs:', err);
        setPrograms([]);
        setProgramCounts({});
      }
    };
    load();
  }, []);

  // ── Profile picture from localStorage ──
  const [profilePic, setProfilePic] = useState(
    localStorage.getItem('userProfilePic') ||
      'https://cdn-icons-png.flaticon.com/512/847/847969.png'
  );
  useEffect(() => {
    const handleStorage = () => {
      const saved = localStorage.getItem('userProfilePic');
      if (saved) setProfilePic(saved);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ── Filtered programs ──
  const filteredPrograms = searchQuery
    ? programs.filter((p) => normalizeName(p).includes(normalizeName(searchQuery)))
    : programs;

  // ── Display programs (with badges) ──
  const displayPrograms = useCallback(() => {
    const container = document.getElementById('programList');
    if (!container) return;
    container.innerHTML = '';
    if (!filteredPrograms.length) {
      container.innerHTML =
        '<div class="text-center py-12 text-muted-foreground">📚 No programs uploaded yet. Be the first to upload!</div>';
      return;
    }
    const seenData = JSON.parse(localStorage.getItem('programSeen') || '{}');
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
    filteredPrograms.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'bg-card border border-border rounded-xl p-4 flex items-center justify-between hover:shadow-md transition-all cursor-pointer hover:border-blue-500';
      card.addEventListener('click', () => {
        const currentCount = programCounts[p] || 0;
        const seen = JSON.parse(localStorage.getItem('programSeen') || '{}');
        seen[p] = currentCount;
        localStorage.setItem('programSeen', JSON.stringify(seen));
        navigate(`/program-detail?program=${encodeURIComponent(p)}`);
      });

      const title = document.createElement('span');
      title.className = 'font-medium text-foreground';
      title.textContent = p;
      card.appendChild(title);

      const lastSeen = seenData[p] || 0;
      const unread = Math.max(0, (programCounts[p] || 0) - lastSeen);
      if (unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'bg-blue-500 text-white text-xs font-semibold px-2 py-1 rounded-full';
        badge.textContent = unread;
        card.appendChild(badge);
      }
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }, [filteredPrograms, programCounts, navigate]);

  useEffect(() => {
    displayPrograms();
  }, [displayPrograms]);

  // ── Search with debounce ──
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      // trigger re-render – searchQuery already updated, we rely on useEffect below
    }, 200);
  }, [searchQuery]);

  // Redisplay when searchQuery or programs change
  useEffect(() => {
    displayPrograms();
  }, [searchQuery, programs, displayPrograms]);

  return (
    <div className="h-screen overflow-y-auto bg-gradient-to-br from-blue-50 to-purple-50 pb-16 lg:pb-0 w-full">
      
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border px-0 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3 px-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
              <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-xl font-bold text-black">Programs</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search programs..."
              className="pl-8 pr-3 py-1.5 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36 sm:w-48"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
          </div>

          <button
            className="p-1 -mr-2 rounded-full hover:bg-accent transition-colors"
            onClick={() => navigate('/profile')}
          >
            <img
              src={profilePic}
              alt="Profile"
              className="w-7 h-7 rounded-full border-2 border-blue-500 shadow-sm"
            />
          </button>
        </div>
      </header>

      {/* ===== PROGRAM LIST ===== */}
      <div className="px-4 py-4">
        <div id="programList" className="w-full"></div>
      </div>

      <BottomNav />
    </div>
  );
}