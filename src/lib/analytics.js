// src/lib/analytics.js
// Google Analytics 4 (GA4) integration for StudyHub Web & Capacitor Android

export const GA_MEASUREMENT_ID = 'G-8YPDKR3B3F';

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

export function trackQuizCompleted({ course, score, total, percentage } = {}) {
  trackEvent('quiz_completed', {
    course_name: course,
    score: score || 0,
    total_questions: total || 0,
    percentage: percentage || Math.round(((score || 0) / (total || 1)) * 100),
  });
}

export function trackNotesViewed({ filename, subject, program } = {}) {
  trackEvent('notes_viewed', {
    filename,
    subject,
    program,
  });
}

export function trackSearch({ query, section = 'general' } = {}) {
  if (!query || !query.trim()) return;
  trackEvent('search', {
    search_term: query.trim(),
    section,
  });
}

export function trackAiChatPrompt() {
  trackEvent('ai_chat_message', {
    timestamp: new Date().toISOString(),
  });
}
