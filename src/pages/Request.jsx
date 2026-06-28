import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';

const RequestNotes = () => {
  const navigate = useNavigate();

  // ─── Form state ──────────────────────────────────────────────
  const [topic, setTopic] = useState('');
  const [course, setCourse] = useState('');
  const [program, setProgram] = useState('');
  const [semester, setSemester] = useState('');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');

  // ─── UI state ────────────────────────────────────────────────
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // ─── Load programs on mount ──────────────────────────────────
  useEffect(() => {
    const loadPrograms = async () => {
      try {
        const res = await fetch('https://studyhub-backend-opdd.onrender.com/api/programs');
        if (!res.ok) throw new Error('Failed to load programs');
        const data = await res.json();
        setPrograms(data.programs || []);
      } catch (err) {
        console.error('Error loading programs:', err);
        setError('Could not load programs. Please refresh.');
      }
    };
    loadPrograms();
  }, []);

  // ─── Handle form submission ──────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Basic validation
    if (!topic || !course || !program || !semester) {
      setError('Please fill in all required fields.');
      return;
    }

    setLoading(true);
    setSuccess(false);
    setError('');

    try {
      const payload = { topic, course, program, semester, notes, email };
      const res = await fetch('https://studyhub-backend-opdd.onrender.com/submit-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSuccess(true);
        // Reset form
        setTopic('');
        setCourse('');
        setProgram('');
        setSemester('');
        setNotes('');
        setEmail('');
      } else {
        const errorText = await res.text();
        setError(`Request failed (${res.status}). ${errorText || 'Please try again.'}`);
      }
    } catch (err) {
      console.error('Network error:', err);
      setError('Unable to connect. Check your internet and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 pb-16 lg:pb-0 w-full">
      {/* ─── Sticky Header ─── */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-medium text-foreground">Request Notes</h1>
        </div>
        <button
          className="p-1 rounded-full hover:bg-accent transition-colors"
          onClick={() => navigate('/profile')}
        >
          <img
            src={localStorage.getItem('userProfilePic') || 'https://cdn-icons-png.flaticon.com/512/847/847969.png'}
            alt="Profile"
            className="w-8 h-8 rounded-full border-2 border-blue-500 shadow-sm"
          />
        </button>
      </header>

      {/* ─── Main Content ─── */}
      <div className="flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-white/50 transition-all animate-fade-up">
          <h2 className="text-2xl font-bold text-center text-foreground mb-6">
            📝 Request Notes
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Topic */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Topic <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter topic"
                className="w-full px-4 py-2.5 bg-white/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-foreground placeholder:text-muted-foreground"
                required
              />
            </div>

            {/* Course */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Course / Subject <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                placeholder="Enter course"
                className="w-full px-4 py-2.5 bg-white/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-foreground placeholder:text-muted-foreground"
                required
              />
            </div>

            {/* Program */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Your Program <span className="text-red-500">*</span>
              </label>
              <select
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-foreground"
                required
              >
                <option value="">-- Select your program --</option>
                {programs.map((prog) => (
                  <option key={prog} value={prog}>
                    {prog}
                  </option>
                ))}
              </select>
            </div>

            {/* Semester */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Semester <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                placeholder="e.g., 1, 2, 3..."
                className="w-full px-4 py-2.5 bg-white/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-foreground placeholder:text-muted-foreground"
                required
              />
            </div>

            {/* Additional Notes */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Additional Notes <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full px-4 py-2.5 bg-white/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-foreground placeholder:text-muted-foreground"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Your Email <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@mail.com"
                className="w-full px-4 py-2.5 bg-white/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-foreground placeholder:text-muted-foreground"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all disabled:opacity-70 shadow-lg flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Sending...
                </>
              ) : (
                'Submit Request'
              )}
            </button>

            {/* Success Message */}
            {success && (
              <div className="mt-3 p-3 bg-green-50/80 border border-green-200 rounded-lg text-green-700 text-sm text-center animate-fade-up">
                ✅ Request submitted successfully!
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="mt-3 p-3 bg-red-50/80 border border-red-200 rounded-lg text-red-600 text-sm text-center animate-fade-up">
                ⚠️ {error}
              </div>
            )}
          </form>

          {/* Back to Home */}
          <div className="mt-6 text-center">
            <button
              onClick={() => navigate('/')}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Navigation */}
      <BottomNav />
    </div>
  );
};

export default RequestNotes;