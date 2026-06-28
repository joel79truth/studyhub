import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Course.css';

// Shared subject data – keep in sync with Quiz.jsx
const SUBJECTS = {
  'agricultural-economics': {
    id: 'agricultural-economics',
    title: 'Agricultural Economics',
    icon: '📊',
    description: 'Supply, demand, markets, and policy.',
  },
  statistics: {
    id: 'statistics',
    title: 'Statistics',
    icon: '📈',
    description: 'Data, probability, and analysis.',
  },
  'soil-science': {
    id: 'soil-science',
    title: 'Soil Science',
    icon: '🌱',
    description: 'Soil types, nutrients, and conservation.',
  },
  'crop-production': {
    id: 'crop-production',
    title: 'Crop Production',
    icon: '🌾',
    description: 'Planting, pests, irrigation, and rotation.',
  },
};

const Course = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    subjectScores: {},
    totalCorrect: 0,
    totalQuestions: 0,
    completed: 0,
    streak: 0,
  });

  // Load stats from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('studyhub_stats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setStats(parsed);
      } catch (_) {}
    }
  }, []);

  // Compute average score per subject
  const subjectAverages = {};
  Object.keys(SUBJECTS).forEach((id) => {
    const scores = stats.subjectScores?.[id] || [];
    if (scores.length > 0) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      subjectAverages[id] = Math.round(avg);
    } else {
      subjectAverages[id] = null; // no attempts yet
    }
  });

  // Categorize subjects
  const strongSubjects = Object.keys(subjectAverages).filter(
    (id) => subjectAverages[id] !== null && subjectAverages[id] >= 70
  );
  const weakSubjects = Object.keys(subjectAverages).filter(
    (id) => subjectAverages[id] !== null && subjectAverages[id] < 70
  );
  const untakenSubjects = Object.keys(SUBJECTS).filter(
    (id) => subjectAverages[id] === null
  );

  // Overall stats
  const totalAttempts = stats.completed || 0;
  const overallScore =
    stats.totalQuestions > 0
      ? Math.round((stats.totalCorrect / stats.totalQuestions) * 100)
      : 0;

  // Helper to start quiz for a subject
  const startQuiz = (subjectId) => {
    // Navigate to Quiz page and pass subject via state
    navigate('/quiz', { state: { subjectId } });
  };

  return (
    <div className="course-page">
      <div className="course-header">
        <h1><i className="fas fa-graduation-cap"></i> Course Dashboard</h1>
        <p className="text-muted">
          Your performance across all subjects – keep improving!
        </p>
      </div>

      {/* Stats summary */}
      <div className="course-summary">
        <div className="summary-card">
          <span className="summary-icon">📚</span>
          <div>
            <div className="summary-number">{totalAttempts}</div>
            <div className="summary-label">Quizzes Taken</div>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon">📈</span>
          <div>
            <div className="summary-number">{overallScore}%</div>
            <div className="summary-label">Overall GPA</div>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-icon">🔥</span>
          <div>
            <div className="summary-number">{stats.streak || 0}</div>
            <div className="summary-label">Day Streak</div>
          </div>
        </div>
      </div>

      {/* Strong Subjects */}
      {strongSubjects.length > 0 && (
        <section className="course-section">
          <h2>🌟 Courses You Excel In</h2>
          <p className="section-subtitle">Keep up the great work!</p>
          <div className="course-grid">
            {strongSubjects.map((id) => {
              const subj = SUBJECTS[id];
              const score = subjectAverages[id];
              return (
                <div key={id} className="course-card strong">
                  <div className="course-icon">{subj.icon}</div>
                  <div className="course-info">
                    <h3>{subj.title}</h3>
                    <p className="course-meta">Average: {score}%</p>
                    <div className="course-progress-bar">
                      <div className="course-progress-fill" style={{ width: `${score}%`, background: '#10b981' }} />
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => startQuiz(id)}
                  >
                    Review
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Weak Subjects – need improvement */}
      {weakSubjects.length > 0 && (
        <section className="course-section">
          <h2>📖 Need Improvement</h2>
          <p className="section-subtitle">Focus on these subjects to boost your GPA</p>
          <div className="course-grid">
            {weakSubjects.map((id) => {
              const subj = SUBJECTS[id];
              const score = subjectAverages[id];
              return (
                <div key={id} className="course-card weak">
                  <div className="course-icon">{subj.icon}</div>
                  <div className="course-info">
                    <h3>{subj.title}</h3>
                    <p className="course-meta">Average: {score}%</p>
                    <div className="course-progress-bar">
                      <div className="course-progress-fill" style={{ width: `${score}%`, background: '#ef4444' }} />
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => startQuiz(id)}
                  >
                    Improve
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Untaken subjects */}
      {untakenSubjects.length > 0 && (
        <section className="course-section">
          <h2>🚀 Not Yet Started</h2>
          <p className="section-subtitle">Take your first quiz to start tracking</p>
          <div className="course-grid">
            {untakenSubjects.map((id) => {
              const subj = SUBJECTS[id];
              return (
                <div key={id} className="course-card untaken">
                  <div className="course-icon">{subj.icon}</div>
                  <div className="course-info">
                    <h3>{subj.title}</h3>
                    <p className="course-meta">No attempts yet</p>
                  </div>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => startQuiz(id)}
                  >
                    Start
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* If no data at all */}
      {!stats.completed && (
        <div className="empty-state">
          <i className="fas fa-chart-simple" style={{ fontSize: '3rem', color: '#d1d5db' }}></i>
          <h3>No quiz data yet</h3>
          <p>Complete a quiz to see your performance dashboard.</p>
          <button className="btn btn-primary" onClick={() => navigate('/quiz')}>
            Go to Quiz Center
          </button>
        </div>
      )}
    </div>
  );
};

export default Course;