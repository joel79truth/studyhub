import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import './Quiz.css';
import { BottomNav } from "../components/BottomNav";

// ============================================================
//  UTILITY FUNCTIONS
// ============================================================
const shuffleArray = (arr) => {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

const getAnswerLetter = (index) => String.fromCharCode(65 + index);

// ============================================================
//  BADGE DEFINITIONS
// ============================================================
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

// ============================================================
//  MAIN QUIZ COMPONENT
// ============================================================
const Quiz = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // ── State ──
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

  // ── Local UI states ──
  const [isFetchingQuestions, setIsFetchingQuestions] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [pendingQuizState, setPendingQuizState] = useState(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [unansweredCount, setUnansweredCount] = useState(0);

  // ── Memoized derived data ──
  const accuracy = useMemo(() => {
    if (stats.totalQuestions === 0) return 0;
    return Math.round((stats.totalCorrect / stats.totalQuestions) * 100);
  }, [stats.totalCorrect, stats.totalQuestions]);

  const earnedBadges = useMemo(() => {
    return BADGE_DEFS.filter(badge => badge.condition(stats)).map(b => b.id);
  }, [stats]);

  // Update stats.badges when earnedBadges changes
  useEffect(() => {
    const newBadges = earnedBadges.filter(id => !stats.badges.includes(id));
    if (newBadges.length > 0) {
      setStats(prev => ({
        ...prev,
        badges: [...new Set([...prev.badges, ...newBadges])]
      }));
    }
  }, [earnedBadges, stats.badges]);

  // ── Fetch user and courses ──
  const fetchUserAndCourses = useCallback(async (user) => {
    try {
      setLoading(true);
      setError(null);

      if (!user) {
        setError('You are not logged in. Please log in to view your courses.');
        setLoading(false);
        return;
      }

      let { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('program, semester')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) throw new Error('Error fetching profile: ' + profileError.message);

      if (!profile) {
        const { error: upsertError } = await supabase
          .from('profiles')
          .upsert(
            { id: user.id, program: null, semester: null },
            { onConflict: 'id', ignoreDuplicates: true }
          );
        if (upsertError) throw new Error('Could not create profile: ' + upsertError.message);

        const { data: reProfile, error: reProfileError } = await supabase
          .from('profiles')
          .select('program, semester')
          .eq('id', user.id)
          .maybeSingle();

        if (reProfileError) throw new Error('Error re-fetching profile: ' + reProfileError.message);
        if (reProfile && reProfile.program && reProfile.semester != null) {
          profile = reProfile;
        } else {
          setError('Your profile is incomplete. Please set your program and semester in Settings.');
          setLoading(false);
          return;
        }
      }

      const { program: programName, semester: semesterNum } = profile;
      if (!programName || semesterNum == null) {
        setError('Your profile is incomplete. Please set your program and semester in Settings.');
        setLoading(false);
        return;
      }

      const { data: programData, error: programError } = await supabase
        .from('programs')
        .select('id')
        .eq('name', programName)
        .maybeSingle();

      if (programError) throw new Error('Program not found: ' + programError.message);
      if (!programData) throw new Error(`Program "${programName}" not found.`);

      const programId = programData.id;

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
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
          setError('You are not logged in. Please log in to view your courses.');
          setLoading(false);
          return;
        }
        await fetchUserAndCourses(user);
      } catch (err) {
        console.error('Auth init error:', err);
        setError('Authentication failed. Please log in again.');
        setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          const user = session?.user;
          if (user && isMounted) {
            await fetchUserAndCourses(user);
          }
        }
        if (event === 'SIGNED_OUT') {
          if (isMounted) {
            setSubjects({});
            setError('You have been signed out.');
          }
        }
      }
    );

    authSubscription = subscription;

    return () => {
      isMounted = false;
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
    };
  }, [fetchUserAndCourses]);

  // ── Restore saved quiz state with custom modal ──
  useEffect(() => {
    const saved = localStorage.getItem('studyhub_stats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setStats((prev) => ({ ...prev, ...parsed }));
      } catch (_) {}
    }
    const savedQuiz = localStorage.getItem('studyhub_quiz_state');
    if (savedQuiz) {
      try {
        const quizData = JSON.parse(savedQuiz);
        if (quizData && quizData.questions && quizData.questions.length > 0) {
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

  // ── Persist stats ──
  useEffect(() => {
    localStorage.setItem('studyhub_stats', JSON.stringify(stats));
  }, [stats]);

  // ── Persist quiz state ──
  useEffect(() => {
    if (screen === 'quiz' && !quizCompleted) {
      const quizState = {
        subjectId: currentSubjectId,
        index: currentIndex,
        answers: answers,
        questions: questions,
      };
      localStorage.setItem('studyhub_quiz_state', JSON.stringify(quizState));
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

  // ── Quiz handlers ──
  const fetchQuestionsForCourse = useCallback(async (courseId, difficulty) => {
    let query = supabase
      .from('questions')
      .select('*')
      .eq('course_id', courseId);
    if (difficulty !== 'all') {
      query = query.eq('difficulty', difficulty);
    }
    const { data, error } = await query;
    if (error) {
      console.error('Error fetching questions:', error);
      return [];
    }
    return data;
  }, []);

  const startQuiz = useCallback(async (subjectId, count, difficulty) => {
    setIsFetchingQuestions(true);
    try {
      const questionsFromDB = await fetchQuestionsForCourse(subjectId, difficulty);
      if (questionsFromDB.length === 0) {
        alert('No questions available for this subject with the selected difficulty. Try a different setting.');
        setIsFetchingQuestions(false);
        return;
      }
      const formattedQuestions = questionsFromDB.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        correct_answer: q.correct_answer,
        difficulty: q.difficulty,
        explanation: q.explanation || 'No explanation provided.',
        topic: q.topic || 'General',
      }));
      const shuffled = shuffleArray(formattedQuestions);
      const selected = shuffled.slice(0, Math.min(count, shuffled.length));
      setQuestions(selected);
      setCurrentIndex(0);
      setAnswers({});
      setQuizCompleted(false);
      setResults(null);
      setScreen('quiz');
    } catch (err) {
      console.error('Error starting quiz:', err);
      alert('Failed to load questions. Please try again.');
    } finally {
      setIsFetchingQuestions(false);
    }
  }, [fetchQuestionsForCourse]);

  const startSetup = useCallback((subjectId) => {
    setCurrentSubjectId(subjectId);
    setScreen('setup');
  }, []);

  const selectOption = useCallback((optionIndex) => {
    setAnswers(prev => ({ ...prev, [currentIndex]: optionIndex }));
  }, [currentIndex]);

  const goToQuestion = useCallback((index) => {
    setCurrentIndex(index);
  }, []);

  const handleSubmitClick = useCallback(() => {
    const total = questions.length;
    let unanswered = 0;
    for (let i = 0; i < total; i++) {
      if (answers[i] === undefined) unanswered++;
    }
    if (unanswered > 0) {
      setUnansweredCount(unanswered);
      setShowSubmitConfirm(true);
    } else {
      submitQuiz();
    }
  }, [questions, answers]);

  const submitQuiz = useCallback(() => {
    let correct = 0;
    const resultDetails = questions.map((q, idx) => {
      const selected = answers[idx];
      const isCorrect = selected !== undefined && q.options[selected] === q.correct_answer;
      if (isCorrect) correct++;
      return {
        question: q.question,
        selected: selected !== undefined ? q.options[selected] : null,
        correct: q.correct_answer,
        isCorrect,
        explanation: q.explanation,
        topic: q.topic,
      };
    });

    const total = questions.length;
    const percentage = (correct / total) * 100;

    // Update stats
    setStats(prev => {
      const newStats = { ...prev };
      newStats.totalQuestions += total;
      newStats.totalCorrect += correct;
      newStats.completed += 1;

      const subjectId = currentSubjectId;
      if (!newStats.subjectScores[subjectId]) {
        newStats.subjectScores[subjectId] = [];
      }
      newStats.subjectScores[subjectId].push(percentage);

      const today = new Date().toDateString();
      if (newStats.lastActivity !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (newStats.lastActivity === yesterday.toDateString()) {
          newStats.streak += 1;
        } else {
          newStats.streak = 1;
        }
      }
      newStats.lastActivity = today;

      let bestSubject = null;
      let bestAvg = -1;
      for (const sid in newStats.subjectScores) {
        const scores = newStats.subjectScores[sid];
        if (scores.length > 0) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          if (avg > bestAvg) {
            bestAvg = avg;
            bestSubject = sid;
          }
        }
      }
      newStats.bestSubject = bestSubject;

      return newStats;
    });

    // Save leaderboard entry
    const leaderboardEntry = {
      subject: currentSubjectId,
      score: percentage,
      date: new Date().toISOString(),
    };
    let leaderboard = [];
    try {
      const data = localStorage.getItem('studyhub_leaderboard');
      if (data) leaderboard = JSON.parse(data);
    } catch (_) {}
    leaderboard.push(leaderboardEntry);
    leaderboard.sort((a, b) => b.score - a.score || new Date(b.date) - new Date(a.date));
    localStorage.setItem('studyhub_leaderboard', JSON.stringify(leaderboard));

    setResults({
      correct,
      total,
      percentage,
      details: resultDetails,
    });
    setQuizCompleted(true);
    setScreen('results');
    setShowSubmitConfirm(false);
  }, [questions, answers, currentSubjectId]);

  const retryQuiz = useCallback(() => {
    setCurrentIndex(0);
    setAnswers({});
    setQuizCompleted(false);
    setResults(null);
    setScreen('setup');
  }, []);

  const goHome = useCallback(() => {
    setScreen('home');
  }, []);

  // ── Render functions ──

  const renderHome = useCallback(() => {
    const subjectIds = Object.keys(subjects);
    return (
      <div className="quiz-home">
        <div className="home-header-row">
          <div>
            <h1>📚 Study Quiz</h1>
            <p className="text-muted">Test your engineering and agriculture subject knowledge</p>
          </div>
          <button className="btn btn-secondary leaderboard-btn-top" onClick={() => setScreen('leaderboard')}>
            🏆 Leaderboard
          </button>
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
        {subjectIds.length === 0 ? (
          <div className="empty-state">
            <p>No courses available. Please verify your program and semester configuration in Settings.</p>
          </div>
        ) : (
          <div className="subject-list">
            {subjectIds.map(id => (
              <div key={id} className="subject-card" onClick={() => startSetup(id)}>
                <div className="subject-left-block">
                  <span className="subject-icon">{subjects[id].icon || '📘'}</span>
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
  }, [stats, accuracy, subjects, startSetup]);

  const renderSetup = useCallback(() => {
    const subject = subjects[currentSubjectId];
    if (!subject) return <div className="state-message">Subject module details could not be found.</div>;
    
    return (
      <div className="quiz-setup">
        <div className="setup-header-card">
          <span className="setup-module-badge">{subject.code || "MODULE"}</span>
          <h2>{subject.icon} {subject.title}</h2>
          <p className="text-muted">Configure question quantity preferences and test difficulty modes.</p>
        </div>

        <div className="setup-controls">
          <div className="control-group">
            <label className="control-label">Total Questions</label>
            <div className="custom-preset-grid">
              {[5, 10, 15, 20, 30].map((num) => (
                <button
                  key={num}
                  type="button"
                  className={`preset-chip-btn ${setupCount === num ? 'active' : ''}`}
                  onClick={() => setSetupCount(num)}
                >
                  {num} Questions
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <label className="control-label">Difficulty Rating</label>
            <div className="custom-preset-grid">
              {['easy', 'medium', 'hard', 'all'].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`preset-chip-btn capitalize ${setupDifficulty === level ? 'active' : ''}`}
                  onClick={() => setSetupDifficulty(level)}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="setup-actions">
          <button className="btn btn-primary btn-xl flex-1" onClick={() => startQuiz(currentSubjectId, setupCount, setupDifficulty)}>
            🚀 Initialize Quiz Session
          </button>
          <button className="btn btn-outline btn-xl" onClick={goHome}>Cancel & Return</button>
        </div>

        {isFetchingQuestions && (
          <div className="loading-overlay">
            <div className="spinner" />
            <p className="loading-text">Assembling question data sheets...</p>
          </div>
        )}
      </div>
    );
  }, [subjects, currentSubjectId, setupCount, setupDifficulty, startQuiz, goHome, isFetchingQuestions]);

  const renderQuiz = useCallback(() => {
    if (!questions.length) return <div className="state-message">No questions matching criteria.</div>;
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
          {q.options.map((opt, idx) => {
            const isCurrentSelected = selected === idx;
            return (
              <div 
                key={idx} 
                className={`option-choice-row ${isCurrentSelected ? 'selected' : ''}`} 
                onClick={() => selectOption(idx)}
              >
                <div className="option-letter-badge">{getAnswerLetter(idx)}</div>
                <div className="option-body-text">{opt}</div>
              </div>
            );
          })}
        </div>

        <div className="quiz-action-navigation-bar">
          <button 
            className="btn btn-outline btn-nav-action" 
            disabled={currentIndex === 0} 
            onClick={() => goToQuestion(currentIndex - 1)}
          >
            ← Previous Question
          </button>
          
          {currentIndex === total - 1 ? (
            <button className="btn btn-success btn-nav-action" onClick={handleSubmitClick}>
              🏁 Finalize & Submit
            </button>
          ) : (
            <button className="btn btn-primary btn-nav-action" onClick={() => goToQuestion(currentIndex + 1)}>
              Next Question →
            </button>
          )}
        </div>
      </div>
    );
  }, [questions, currentIndex, answers, selectOption, goToQuestion, handleSubmitClick]);

  const renderResults = useCallback(() => {
    if (!results) return null;
    const { correct, total, percentage } = results;
    const newBadges = stats.badges.map(bid => BADGE_DEFS.find(def => def.id === bid)).filter(Boolean);
    
    return (
      <div className="quiz-results text-center">
        <div className="celebration-header">
          <span className="celebration-emoji">🏆</span>
          <h2>Session Completed!</h2>
          <p className="text-muted">Your performance assessment metrics are calculated below</p>
        </div>

        <div className="score-summary-dashboard">
          <div className="score-radial-container">
            <span className="score-percentage-value">{Math.round(percentage)}%</span>
            <span className="score-label-subtitle">Total Grade</span>
          </div>
          <div className="score-fractional-card">
            <span className="fraction-value">{correct} / {total}</span>
            <span className="fraction-label">Correct Answers Documented</span>
          </div>
        </div>

        {newBadges.length > 0 && (
          <div className="badges-unlocked-section">
            <h4>Badges Maintained / Achieved</h4>
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
            🔍 Review Answer Sheet
          </button>
          <button className="btn btn-outline btn-xl" onClick={retryQuiz}>
            🔄 Restart Session
          </button>
          <button className="btn btn-secondary btn-xl" onClick={goHome}>
            🏠 Core Dashboard
          </button>
        </div>
      </div>
    );
  }, [results, stats.badges, retryQuiz, goHome]);

  const renderReview = useCallback(() => {
    if (!results) return null;
    const { details } = results;
    
    return (
      <div className="quiz-review">
        <div className="review-header-sticky">
          <h2>Correction & Explanation Sheet</h2>
          <p className="text-muted">Analyze incorrect answer variants and descriptive review details.</p>
        </div>

        <div className="review-cards-stack">
          {details.map((item, idx) => (
            <div key={idx} className={`review-card-item ${item.isCorrect ? 'pass-border' : 'fail-border'}`}>
              <div className="review-meta-row">
                <span className="review-index-badge">Item #{idx + 1}</span>
                <span className={`review-status-pill ${item.isCorrect ? 'correct' : 'incorrect'}`}>
                  {item.isCorrect ? '✓ Correct Answer' : '✕ Incorrect Variant'}
                </span>
              </div>
              
              <div className="review-question-text">{item.question}</div>
              
              <div className="review-selections-comparison">
                <div className={`selection-pill-display ${item.isCorrect ? 'correct-style' : 'incorrect-style'}`}>
                  <strong>Your Input:</strong> {item.selected ? item.selected : 'No Input Tracked'}
                </div>
                {!item.isCorrect && (
                  <div className="selection-pill-display standard-correct-style">
                    <strong>Expected Answer:</strong> {item.correct}
                  </div>
                )}
              </div>

              <div className="review-explanation-box">
                <span className="explanation-title">Descriptive Analytics</span>
                <p>{item.explanation}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="review-actions-footer">
          <button className="btn btn-primary btn-xl" onClick={() => setScreen('results')}>
            ← Back to Performance Summary
          </button>
        </div>
      </div>
    );
  }, [results]);

  const renderLeaderboard = useCallback(() => {
    let leaderboard = [];
    try {
      const data = localStorage.getItem('studyhub_leaderboard');
      if (data) leaderboard = JSON.parse(data);
    } catch (_) {}
    
    return (
      <div className="quiz-leaderboard">
        <div className="leaderboard-header">
          <h2>🏆 Top Performance Records</h2>
          <p className="text-muted">Historical scores achieved during your recent review sessions</p>
        </div>

        {leaderboard.length === 0 ? (
          <div className="empty-state">
            <p>No logged attempts captured yet. Submit a course module evaluation sheet to populate data.</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="modern-leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Subject Module</th>
                  <th>Grade Rating</th>
                  <th>Evaluation Date</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.slice(0, 10).map((entry, idx) => {
                  const subjectName = subjects[entry.subject]?.title || entry.subject;
                  return (
                    <tr key={idx} className={`rank-row-${idx + 1}`}>
                      <td>
                        <span className="rank-number-badge">{idx + 1}</span>
                      </td>
                      <td className="table-bold-text">{subjectName}</td>
                      <td>
                        <span className="table-score-pill">{entry.score}%</span>
                      </td>
                      <td className="text-muted">{new Date(entry.date).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        
        <div className="leaderboard-actions-footer">
          <button className="btn btn-outline btn-xl" onClick={goHome}>
            Return to Main Dashboard
          </button>
        </div>
      </div>
    );
  }, [subjects, goHome]);

  // ── Modals ──
  const renderResumeModal = () => {
    if (!showResumeModal) return null;
    return (
      <div className="modal-backdrop-blur">
        <div className="modal-dialog-box">
          <div className="modal-icon-header">⏳</div>
          <h3>Unsaved Progress Found</h3>
          <p>You have an incomplete quiz session on file. Would you like to restore your coordinates or clear cache?</p>
          <div className="modal-button-layout">
            <button className="btn btn-primary flex-1" onClick={handleResumeQuiz}>Resume Session</button>
            <button className="btn btn-outline" onClick={handleDiscardQuiz}>Discard</button>
          </div>
        </div>
      </div>
    );
  };

  const renderSubmitConfirmModal = () => {
    if (!showSubmitConfirm) return null;
    return (
      <div className="modal-backdrop-blur">
        <div className="modal-dialog-box">
          <div className="modal-icon-header warning">⚠️</div>
          <h3>Incomplete Evaluation Form</h3>
          <p>You left <strong>{unansweredCount}</strong> questions unanswered. Force submission check or return to form?</p>
          <div className="modal-button-layout">
            <button className="btn btn-danger flex-1" onClick={submitQuiz}>Force Complete Evaluation</button>
            <button className="btn btn-outline" onClick={() => setShowSubmitConfirm(false)}>Go Back</button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main render ──
  if (loading) {
    return (
      <div className="quiz-app-container page-loading-wrapper">
        <div className="spinner-center-box">
          <div className="spinner" />
          <p className="loading-text">Syncing campus syllabus registry databases...</p>
        </div>
        <BottomNav />
      </div>
    );
  }

  if (error) {
    return (
      <div className="quiz-app-container page-error-wrapper">
        <div className="error-center-box">
          <span className="error-icon-graphic">⚠️</span>
          <h3>Database Communication Error</h3>
          <p className="error-details-text">{error}</p>
          {error.includes('not logged in') || error.includes('signed out') ? (
            <button className="btn btn-primary btn-xl" onClick={() => navigate('/login')}>
              Redirect to Account Login
            </button>
          ) : (
            <button className="btn btn-primary btn-xl" onClick={() => window.location.reload()}>
              Retry Network Connection
            </button>
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
        {screen === 'leaderboard' && renderLeaderboard()}
      </div>
      {renderResumeModal()}
      {renderSubmitConfirmModal()}
      <BottomNav />
    </>
  );
};

export default Quiz;