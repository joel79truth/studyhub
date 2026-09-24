// src/lib/analytics.js
// Google Analytics 4 (GA4) integration for StudyHub Web & Capacitor Android

export const GA_MEASUREMENT_ID = 'G-7MKTE9Z1SD';

/**
 * Safely call window.gtag if initialized
 */
function gtag(...args) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag(...args);
  }
}

/**
 * Track SPA page view on route transitions
 * @param {string} path - URL path (e.g. "/papers", "/quiz", "/AiChat")
 * @param {string} title - Page title
 */
export function trackPageView(path, title = '') {
  if (!path) return;
  gtag('event', 'page_view', {
    page_path: path,
    page_title: title || document.title,
    page_location: window.location.href,
  });
}

/**
 * Track custom user engagement events
 * @param {string} eventName - GA4 event name (e.g. 'quiz_completed', 'paper_viewed')
 * @param {object} params - Event parameters
 */
export function trackEvent(eventName, params = {}) {
  if (!eventName) return;
  gtag('event', eventName, params);
}

/**
 * Set student user profile properties in GA4 (without PII)
 * Allows filtering analytics by program, semester, and role.
 */
export function setAnalyticsUser(userId, { program, semester, year, role } = {}) {
  if (userId) {
    gtag('set', 'user_properties', {
      user_id: userId,
      student_program: program || 'unknown',
      student_semester: semester ? String(semester) : 'unknown',
      student_year: year ? String(year) : 'unknown',
      user_role: role || 'Student',
    });
  }
}

// ── Convenient Pre-configured Event Helpers ─────────────────────────────────

export function trackPaperViewed({ id, title, course, program, semester } = {}) {
  trackEvent('paper_viewed', {
    paper_id: id,
    paper_title: title,
    course_name: course,
    program_name: program,
    semester: String(semester || ''),
  });
}

export function trackQuizCompleted({ course, score, total, percentage, mode } = {}) {
  trackEvent('quiz_completed', {
    course_name: course,
    score: score || 0,
    total_questions: total || 0,
    percentage: percentage || Math.round(((score || 0) / (total || 1)) * 100),
    quiz_mode: mode || 'study',
  });
}

export function trackQuizStarted({ course, mode, questionCount } = {}) {
  trackEvent('quiz_started', {
    course_name: course,
    quiz_mode: mode || 'study',
    question_count: questionCount || 10,
  });
}

export function trackNotesViewed({ filename, subject, program } = {}) {
  trackEvent('notes_viewed', {
    filename,
    subject,
    program,
  });
}

export function trackNotesDownloaded({ filename, subject } = {}) {
  trackEvent('notes_downloaded', {
    filename,
    subject,
  });
}

export function trackSearch({ query, section = 'general' } = {}) {
  if (!query || !query.trim()) return;
  trackEvent('search', {
    search_term: query.trim(),
    section,
  });
}

export function trackAiChatPrompt({ source = 'studybot', hasContext = false } = {}) {
  trackEvent('ai_chat_message', {
    source,
    has_context: hasContext,
    timestamp: new Date().toISOString(),
  });
}

export function trackRecommendationClicked({ type, topic, courseName } = {}) {
  trackEvent('recommendation_clicked', {
    rec_type: type,
    topic,
    course_name: courseName,
  });
}

export function trackLevelUpInteracted({ type, action } = {}) {
  trackEvent('levelup_banner_interacted', {
    suggestion_type: type,
    action, // 'accepted' or 'dismissed'
  });
}

export function trackTimetableViewed() {
  trackEvent('timetable_viewed');
}
