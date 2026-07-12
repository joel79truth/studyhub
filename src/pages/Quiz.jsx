import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import './Quiz.css';
import { BottomNav } from '../components/BottomNav';

// ──────────────────────────────────────────────
//  UTILITY FUNCTIONS
// ──────────────────────────────────────────────
const shuffleArray = (arr) => {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

const getAnswerLetter = (index) => String.fromCharCode(65 + index);

// ──────────────────────────────────────────────
//  BADGE DEFINITIONS
// ──────────────────────────────────────────────
const BADGE_DEFS = [
  { id: 'first_quiz', label: 'First Quiz', icon: '🏁', condition: (s) => s.completed >= 1 },
  { id: 'streak_3', label: '3-Day Streak', icon: '🔥', condition: (s) => s.streak >= 3 },
  { id: 'streak_7', label: '7-Day Streak', icon: '⚡', condition: (s) => s.streak >= 7 },
  { id: 'master_90', label: 'Mastery 90%', icon: '🏆', condition: (s) => s.totalQuestions > 0 && (s.totalCorrect / s.totalQuestions) >= 0.9 },
  { id: '100_questions', label: '100 Questions', icon: '📚', condition: (s) => s.totalQuestions >= 100 },
  { id: 'subject_master', label: 'Subject Master', icon: '🌟', condition: (s) => {
      for (const sid in s.subjectScores) {
        const scores = s.subjectScores[sid];
        if (scores.length >= 3) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          if (avg >= 80) return true;
        }
      }
      return false;
    }
  },
];

// ──────────────────────────────────────────────
//  MAIN QUIZ COMPONENT
// ──────────────────────────────────────────────
const Quiz = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [screen, setScreen] = useState('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [subjects, setSubjects] = useState({});
  const [currentSubjectId, setCurrentSubjectId] = useState(null);
  const [setupCount, setSetupCount] = useState(5);
  const [setupDifficulty, setSetupDifficulty] = useState('easy');

  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [results, setResults] = useState(null);

  const [stats, setStats] = useState({
    completed: 0,
    totalCorrect: 0,
    totalQuestions: 0,
    streak: 0,
    lastActivity: null,
    bestSubject: null,
    subjectScores: {},
    badges: [],
  });

  const [user, setUser] = useState(null);
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [pendingQuizState, setPendingQuizState] = useState(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [unansweredCount, setUnansweredCount] = useState(0);

  // ── Derived accuracy ──
  const accuracy = useMemo(() => {
    if (stats.totalQuestions === 0) return 0;
    return Math.round((stats.totalCorrect / stats.totalQuestions) * 100);
  }, [stats.totalCorrect, stats.totalQuestions]);

  const earnedBadges = useMemo(() => {
    return BADGE_DEFS.filter(badge => badge.condition(stats)).map(b => b.id);
  }, [stats]);

  // Merge new badges into DB
  useEffect(() => {
    const newBadges = earnedBadges.filter(id => !stats.badges.includes(id));
    if (newBadges.length > 0) {
      const updatedBadges = [...stats.badges, ...newBadges];
      setStats(prev => ({ ...prev, badges: updatedBadges }));
      if (user) {
        supabase.from('profiles').update({ badges: updatedBadges }).eq('id', user.id)
          .then(({ error }) => { if (error) console.error('Failed to update badges:', error); });
      }
    }
  }, [earnedBadges, stats.badges, user]);

  // ── Load user, profile, and courses ──
  const fetchUserAndCourses = useCallback(async (authUser) => {
    try {
      setLoading(true);
      setError(null);
      if (!authUser) {
        setError('You are not logged in.');
        setLoading(false);
        return;
      }
      setUser(authUser);

      let { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (profileError) throw new Error('Profile fetch error: ' + profileError.message);

      if (!profile) {
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({ id: authUser.id, program: null, semester: null })
          .select('*')
          .single();
        if (insertError) throw new Error('Could not create profile: ' + insertError.message);
        profile = await supabase.from('profiles').select('*').eq('id', authUser.id).single().then(r => r.data);
      }

      const profileQuizzesCompleted = profile.quizzes_completed || 0;
      const profileAccuracy = profile.accuracy_rate || 0;
      const profileBadges = profile.badges || [];
      const profileStreak = profile.streak || 0;
      const profileLastActive = profile.last_active || null;

      const localStats = JSON.parse(localStorage.getItem('studyhub_stats') || '{}');
      const totalQuestions = localStats.totalQuestions || 0;
      const totalCorrect = localStats.totalCorrect || 0;

      setStats({
        completed: profileQuizzesCompleted,
        totalCorrect,
        totalQuestions,
        streak: profileStreak,
        lastActivity: profileLastActive,
        bestSubject: localStats.bestSubject || null,
        subjectScores: localStats.subjectScores || {},
        badges: profileBadges,
      });

      const programName = profile.program;
      const semesterNum = profile.semester != null ? parseInt(profile.semester, 10) : null;
      if (!programName || semesterNum == null || isNaN(semesterNum)) {
        setError('Please set your program and semester in Settings.');
        setLoading(false);
        return;
      }

      const { data: progData, error: progError } = await supabase
        .from('programs')
        .select('id')
        .eq('name', programName)
        .maybeSingle();
      if (progError || !progData) throw new Error(`Program "${programName}" not found.`);

      const programId = progData.id;

      const { data: courses, error: coursesError } = await supabase
        .from('courses')
        .select('id, course_name, course_code')
        .eq('program_id', programId)
        .eq('semester', semesterNum);
      if (coursesError) throw new Error(coursesError.message);

      const subjectsMap = {};
      courses.forEach(course => {
        subjectsMap[course.id] = {
          id: course.id,
          title: course.course_name,
          code: course.course_code,
          icon: '📘',
          description: ''
        };
      });
      setSubjects(subjectsMap);
      if (Object.keys(subjectsMap).length === 0) {
        setError('No courses found for your program and semester.');
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Auth init ──
  useEffect(() => {
    let isMounted = true;
    let authSubscription = null;

    const initAuth = async () => {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError('You are not logged in.');
          setLoading(false);
          return;
        }
        await fetchUserAndCourses(user);
      } catch (err) {
        console.error('Auth init error:', err);
        setError('Authentication failed.');
        setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const sessionUser = session?.user;
        if (sessionUser && isMounted) await fetchUserAndCourses(sessionUser);
      } else if (event === 'SIGNED_OUT') {
        if (isMounted) { setSubjects({}); setError('Signed out.'); }
      }
    });

    authSubscription = subscription;
    return () => { isMounted = false; if (authSubscription) authSubscription.unsubscribe(); };
  }, [fetchUserAndCourses]);

  // ── Resume quiz from localStorage ──
  useEffect(() => {
    const savedQuiz = localStorage.getItem('studyhub_quiz_state');
    if (savedQuiz) {
      try {
        const quizData = JSON.parse(savedQuiz);
        if (quizData?.questions?.length > 0) {
          setPendingQuizState(quizData);
          setShowResumeModal(true);
        }
      } catch (_) {}
    }
  }, []);

  const handleResumeQuiz = () => {
    if (pendingQuizState) {
      setCurrentSubjectId(pendingQuizState.subjectId);
      setQuestions(pendingQuizState.questions);
      setCurrentIndex(pendingQuizState.index || 0);
      setAnswers(pendingQuizState.answers || {});
      setQuizCompleted(false);
      setResults(null);
      setScreen('quiz');
      localStorage.removeItem('studyhub_quiz_state');
    }
    setShowResumeModal(false);
    setPendingQuizState(null);
  };

  const handleDiscardQuiz = () => {
    localStorage.removeItem('studyhub_quiz_state');
    setShowResumeModal(false);
    setPendingQuizState(null);
  };

  useEffect(() => {
    if (screen === 'quiz' && !quizCompleted) {
      const state = { subjectId: currentSubjectId, index: currentIndex, answers, questions };
      localStorage.setItem('studyhub_quiz_state', JSON.stringify(state));
    } else {
      localStorage.removeItem('studyhub_quiz_state');
    }
  }, [screen, currentSubjectId, currentIndex, answers, questions, quizCompleted]);

  // ── Navigation from location state ──
  useEffect(() => {
    const state = location.state;
    if (state?.subjectId && subjects[state.subjectId]) {
      setCurrentSubjectId(state.subjectId);
      setScreen('setup');
      window.history.replaceState({}, document.title);
    }
  }, [location, subjects]);

  // ── FETCH QUESTIONS (FIXED) ──
  const fetchQuestionsForCourse = useCallback(async (courseId, difficulty) => {
    let query = supabase
      .from('generated_questions')
      .select('*, note_chunks!inner(heading)')
      .eq('course_id', courseId);

    if (difficulty !== 'all') {
      query = query.eq('difficulty', difficulty);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching generated questions:', error);
      return [];
    }

    const formatted = data.map((q) => {
      // Keep all four options exactly as stored
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];
      const correctLetter = q.answer?.trim().toUpperCase();
      let correctIndex = 0;
      if (correctLetter === 'A') correctIndex = 0;
      else if (correctLetter === 'B') correctIndex = 1;
      else if (correctLetter === 'C') correctIndex = 2;
      else if (correctLetter === 'D') correctIndex = 3;

      return {
        id: q.id,
        question: q.question,
        options,
        correct_answer_index: correctIndex,
        difficulty: q.difficulty,
        explanation: q.explanation || 'No explanation provided.',
        topic: q.note_chunks?.heading || 'General',
        hint: q.hint || null,
        subtopic: q.sub_topic_tag || null,
        blooms: q.blooms_level || null,
        source: q.source_reference || null,
      };
    });

    return formatted;
  }, []);

  // ── START QUIZ ──
  const startQuiz = useCallback(async (subjectId, count, difficulty) => {
    setIsFetchingQuestions(true);
    try {
      const questionsFromDB = await fetchQuestionsForCourse(subjectId, difficulty);
      if (questionsFromDB.length === 0) {
        alert('No questions available for this subject. Try a different difficulty.');
        setIsFetchingQuestions(false);
        return;
      }
      const shuffled = shuffleArray(questionsFromDB);
      const selected = shuffled.slice(0, Math.min(count, shuffled.length));
      setQuestions(selected);
      setCurrentIndex(0);
      setAnswers({});
      setQuizCompleted(false);
      setResults(null);
      setScreen('quiz');
    } catch (err) {
      console.error('Error starting quiz:', err);
      alert('Failed to load questions.');
    } finally {
      setIsFetchingQuestions(false);
    }
  }, [fetchQuestionsForCourse]);

  const startSetup = (subjectId) => { setCurrentSubjectId(subjectId); setScreen('setup'); };
  const selectOption = (optionIndex) => setAnswers(prev => ({ ...prev, [currentIndex]: optionIndex }));
  const goToQuestion = (index) => setCurrentIndex(index);

  const handleSubmitClick = () => {
    const unanswered = questions.reduce((acc, _, i) => acc + (answers[i] === undefined ? 1 : 0), 0);
    if (unanswered > 0) {
      setUnansweredCount(unanswered);
      setShowSubmitConfirm(true);
    } else {
      submitQuiz();
    }
  };

  // ── SUBMIT QUIZ (FIXED SCORING) ──
  const submitQuiz = useCallback(async () => {
    let correct = 0;
    const resultDetails = questions.map((q, idx) => {
      const selected = answers[idx];
      const isCorrect = selected !== undefined && selected === q.correct_answer_index;
      if (isCorrect) correct++;
      return {
        question: q.question,
        selected: selected !== undefined ? q.options[selected] : null,
        correct: q.options[q.correct_answer_index],
        isCorrect,
        explanation: q.explanation,
        topic: q.topic,
        hint: q.hint,
        subtopic: q.subtopic,
        source: q.source,
      };
    });

    const total = questions.length;
    const percentage = Math.round((correct / total) * 100);

    setStats(prev => {
      const newStats = { ...prev };
      newStats.totalQuestions += total;
      newStats.totalCorrect += correct;
      newStats.completed += 1;

      const subjectId = currentSubjectId;
      if (!newStats.subjectScores[subjectId]) newStats.subjectScores[subjectId] = [];
      newStats.subjectScores[subjectId].push(percentage);

      const today = new Date().toDateString();
      if (newStats.lastActivity !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        newStats.streak = (newStats.lastActivity === yesterday.toDateString()) ? newStats.streak + 1 : 1;
      }
      newStats.lastActivity = today;

      let bestSubject = null, bestAvg = -1;
      for (const sid in newStats.subjectScores) {
        const scores = newStats.subjectScores[sid];
        if (scores.length > 0) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          if (avg > bestAvg) { bestAvg = avg; bestSubject = sid; }
        }
      }
      newStats.bestSubject = bestSubject;

      if (user) {
        const overallAccuracy = newStats.totalQuestions > 0
          ? Math.round((newStats.totalCorrect / newStats.totalQuestions) * 100)
          : 0;

        supabase.from('profiles').update({
          quizzes_completed: newStats.completed,
          accuracy_rate: overallAccuracy,
          streak: newStats.streak,
          last_active: today,
          badges: newStats.badges,
        }).eq('id', user.id).then(({ error }) => {
          if (error) console.error('Failed to update profile stats:', error);
        });

        localStorage.setItem('studyhub_stats', JSON.stringify({
          totalQuestions: newStats.totalQuestions,
          totalCorrect: newStats.totalCorrect,
          subjectScores: newStats.subjectScores,
          bestSubject: newStats.bestSubject,
        }));
      }

      return newStats;
    });

    setResults({ correct, total, percentage, details: resultDetails });
    setQuizCompleted(true);
    setScreen('results');
    setShowSubmitConfirm(false);
  }, [questions, answers, currentSubjectId, user]);

  const retryQuiz = () => {
    setCurrentIndex(0);
    setAnswers({});
    setQuizCompleted(false);
    setResults(null);
    setScreen('setup');
  };

  const goHome = () => setScreen('home');

  // ── RENDER HOME ──
  const renderHome = () => (
    <div className="quiz-home">
      <div className="home-header-row">
        <div>
          <h1>📚 Study Quiz</h1>
          <p className="text-muted">Test your knowledge with AI‑generated questions</p>
        </div>
      </div>

      <div className="stats-dashboard-grid">
        <div className="stat-widget-card">
          <span className="stat-widget-icon">✅</span>
          <div className="stat-widget-content">
            <span className="stat-widget-value">{stats.completed}</span>
            <span className="stat-widget-label">Completed</span>
          </div>
        </div>
        <div className="stat-widget-card">
          <span className="stat-widget-icon">🔥</span>
          <div className="stat-widget-content">
            <span className="stat-widget-value">{stats.streak} d</span>
            <span className="stat-widget-label">Active Streak</span>
          </div>
        </div>
        <div className="stat-widget-card">
          <span className="stat-widget-icon">🎯</span>
          <div className="stat-widget-content">
            <span className="stat-widget-value">{accuracy}%</span>
            <span className="stat-widget-label">Accuracy Rate</span>
          </div>
        </div>
        <div className="stat-widget-card">
          <span className="stat-widget-icon">🏅</span>
          <div className="stat-widget-content">
            <span className="stat-widget-value">{stats.badges.length}</span>
            <span className="stat-widget-label">Badges Unlocked</span>
          </div>
        </div>
      </div>

      <h3 className="section-title">Select Course Modules</h3>
      {Object.keys(subjects).length === 0 ? (
        <div className="empty-state"><p>No courses available for your program and semester.</p></div>
      ) : (
        <div className="subject-list">
          {Object.keys(subjects).map(id => (
            <div key={id} className="subject-card" onClick={() => startSetup(id)}>
              <div className="subject-left-block">
                <span className="subject-icon">{subjects[id].icon}</span>
                <div className="subject-info-meta">
                  <span className="subject-title">{subjects[id].title}</span>
                  {subjects[id].code && <span className="subject-code">{subjects[id].code}</span>}
                </div>
              </div>
              <span className="subject-action">▶</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── RENDER SETUP ──
  const renderSetup = () => {
    const subject = subjects[currentSubjectId];
    if (!subject) return <div className="state-message">Subject not found.</div>;

    return (
      <div className="quiz-setup">
        <div className="setup-header-card">
          <span className="setup-module-badge">{subject.code || "MODULE"}</span>
          <h2>{subject.icon} {subject.title}</h2>
          <p className="text-muted">Choose question quantity and difficulty.</p>
        </div>
        <div className="setup-controls">
          <div className="control-group">
            <label className="control-label">Total Questions</label>
            <div className="custom-preset-grid">
              {[5, 10, 15, 20, 30].map(num => (
                <button key={num} className={`preset-chip-btn ${setupCount === num ? 'active' : ''}`} onClick={() => setSetupCount(num)}>
                  {num} Questions
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label className="control-label">Difficulty Rating</label>
            <div className="custom-preset-grid">
              {['easy', 'medium', 'hard', 'all'].map(level => (
                <button key={level} className={`preset-chip-btn capitalize ${setupDifficulty === level ? 'active' : ''}`} onClick={() => setSetupDifficulty(level)}>
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="setup-actions">
          <button className="btn btn-primary btn-xl flex-1" onClick={() => startQuiz(currentSubjectId, setupCount, setupDifficulty)}>
            🚀 Start Quiz
          </button>
          <button className="btn btn-outline btn-xl" onClick={goHome}>Cancel</button>
        </div>
        {isFetchingQuestions && (
          <div className="loading-overlay"><div className="spinner" /><p>Loading questions...</p></div>
        )}
      </div>
    );
  };

  // ── RENDER QUIZ ──
  const renderQuiz = () => {
    if (!questions.length) return <div className="state-message">No questions.</div>;
    const q = questions[currentIndex];
    const total = questions.length;
    const progress = ((currentIndex + 1) / total) * 100;
    const selected = answers[currentIndex];

    return (
      <div className="quiz-screen">
        <div className="quiz-header-meta">
          <span className="meta-pill count-pill">Question {currentIndex + 1} of {total}</span>
          <span className={`meta-pill difficulty-pill ${q.difficulty}`}>Difficulty: {q.difficulty}</span>
        </div>
        <div className="progress-bar-wrapper">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="question-box-card">
          <h2 className="question-text">{q.question}</h2>
        </div>
        <div className="options-stack-container">
          {q.options.map((opt, idx) => (
            <div
              key={idx}
              className={`option-choice-row ${selected === idx ? 'selected' : ''}`}
              onClick={() => selectOption(idx)}
            >
              <div className="option-letter-badge">{getAnswerLetter(idx)}</div>
              <div className="option-body-text">{opt}</div>
            </div>
          ))}
        </div>
        <div className="quiz-action-navigation-bar">
          <button className="btn btn-outline btn-nav-action" disabled={currentIndex === 0} onClick={() => goToQuestion(currentIndex - 1)}>
            ← Previous
          </button>
          {currentIndex === total - 1 ? (
            <button className="btn btn-success btn-nav-action" onClick={handleSubmitClick}>
              🏁 Submit
            </button>
          ) : (
            <button className="btn btn-primary btn-nav-action" onClick={() => goToQuestion(currentIndex + 1)}>
              Next →
            </button>
          )}
        </div>
      </div>
    );
  };

  // ── RENDER RESULTS ──
  const renderResults = () => {
    if (!results) return null;
    const { correct, total, percentage } = results;
    const newBadges = stats.badges.map(bid => BADGE_DEFS.find(def => def.id === bid)).filter(Boolean);

    return (
      <div className="quiz-results text-center">
        <div className="celebration-header">
          <span className="celebration-emoji">🏆</span>
          <h2>Session Completed!</h2>
          <p className="text-muted">Your performance assessment</p>
        </div>
        <div className="score-summary-dashboard">
          <div className="score-radial-container">
            <span className="score-percentage-value">{percentage}%</span>
            <span className="score-label-subtitle">Total Grade</span>
          </div>
          <div className="score-fractional-card">
            <span className="fraction-value">{correct} / {total}</span>
            <span className="fraction-label">Correct Answers</span>
          </div>
        </div>
        {newBadges.length > 0 && (
          <div className="badges-unlocked-section">
            <h4>Badges</h4>
            <div className="badges-flex-wrap">
              {newBadges.map(def => (
                <span key={def.id} className="badge-item-pill">
                  <span className="badge-item-icon">{def.icon}</span>
                  <span className="badge-item-label">{def.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="result-actions-footer">
          <button className="btn btn-primary btn-xl flex-1" onClick={() => setScreen('review')}>
            🔍 Review Answers
          </button>
          <button className="btn btn-outline btn-xl" onClick={retryQuiz}>
            🔄 Restart
          </button>
          <button className="btn btn-secondary btn-xl" onClick={goHome}>
            🏠 Dashboard
          </button>
        </div>
      </div>
    );
  };

  // ── RENDER REVIEW ──
  const renderReview = () => {
    if (!results) return null;
    const { details } = results;

    return (
      <div className="quiz-review">
        <div className="review-header-sticky">
          <h2>Answer Sheet</h2>
          <p className="text-muted">Review your answers and explanations</p>
        </div>
        <div className="review-cards-stack">
          {details.map((item, idx) => (
            <div key={idx} className={`review-card-item ${item.isCorrect ? 'pass-border' : 'fail-border'}`}>
              <div className="review-meta-row">
                <span className="review-index-badge">Item #{idx + 1}</span>
                <span className={`review-status-pill ${item.isCorrect ? 'correct' : 'incorrect'}`}>
                  {item.isCorrect ? '✓ Correct' : '✕ Incorrect'}
                </span>
              </div>
              <div className="review-question-text">{item.question}</div>
              <div className="review-selections-comparison">
                <div className={`selection-pill-display ${item.isCorrect ? 'correct-style' : 'incorrect-style'}`}>
                  <strong>Your Answer:</strong> {item.selected || 'None'}
                </div>
                {!item.isCorrect && (
                  <div className="selection-pill-display standard-correct-style">
                    <strong>Correct Answer:</strong> {item.correct}
                  </div>
                )}
              </div>
              <div className="review-explanation-box">
                <span className="explanation-title">Explanation</span>
                <p>{item.explanation}</p>
                {item.hint && <p><em>Hint: {item.hint}</em></p>}
              </div>
            </div>
          ))}
        </div>
        <div className="review-actions-footer">
          <button className="btn btn-primary btn-xl" onClick={() => setScreen('results')}>
            ← Back to Summary
          </button>
        </div>
      </div>
    );
  };

  // ── MODALS ──
  const renderResumeModal = () => (
    showResumeModal && (
      <div className="modal-backdrop-blur">
        <div className="modal-dialog-box">
          <h3>Unsaved Progress</h3>
          <p>You have an incomplete quiz. Resume or discard?</p>
          <div className="modal-button-layout">
            <button className="btn btn-primary flex-1" onClick={handleResumeQuiz}>Resume</button>
            <button className="btn btn-outline" onClick={handleDiscardQuiz}>Discard</button>
          </div>
        </div>
      </div>
    )
  );

  const renderSubmitConfirmModal = () => (
    showSubmitConfirm && (
      <div className="modal-backdrop-blur">
        <div className="modal-dialog-box">
          <h3>Incomplete Answers</h3>
          <p>You left {unansweredCount} question(s) unanswered. Submit anyway?</p>
          <div className="modal-button-layout">
            <button className="btn btn-danger flex-1" onClick={submitQuiz}>Submit Anyway</button>
            <button className="btn btn-outline" onClick={() => setShowSubmitConfirm(false)}>Go Back</button>
          </div>
        </div>
      </div>
    )
  );

  // ── MAIN RENDER ──
  if (loading) {
    return (
      <div className="quiz-app-container page-loading-wrapper">
        <div className="spinner-center-box"><div className="spinner" /><p>Loading...</p></div>
        <BottomNav />
      </div>
    );
  }

  if (error) {
    return (
      <div className="quiz-app-container page-error-wrapper">
        <div className="error-center-box">
          <span className="error-icon-graphic">⚠️</span>
          <h3>Error</h3>
          <p>{error}</p>
          {error.includes('log in') || error.includes('signed out') ? (
            <button className="btn btn-primary btn-xl" onClick={() => navigate('/login')}>Log In</button>
          ) : (
            <button className="btn btn-primary btn-xl" onClick={() => window.location.reload()}>Retry</button>
          )}
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <>
      <div className="quiz-app-container">
        {screen === 'home' && renderHome()}
        {screen === 'setup' && renderSetup()}
        {screen === 'quiz' && renderQuiz()}
        {screen === 'results' && renderResults()}
        {screen === 'review' && renderReview()}
      </div>
      {renderResumeModal()}
      {renderSubmitConfirmModal()}
      <BottomNav />
    </>
  );
};

export default Quiz;