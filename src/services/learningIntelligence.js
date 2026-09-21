// ============================================================================
// Learning Intelligence Service
// The data bus that connects quiz performance → home recommendations → Luna AI.
// All storage is in localStorage so it works offline and never blocks render.
// ============================================================================

const HISTORY_KEY = 'studyhub_quiz_history';
const LEVEL_UP_DISMISSED_KEY = 'studyhub_levelup_dismissed';
const MAX_HISTORY_ENTRIES = 50;

// ─── Read / Write helpers ────────────────────────────────────────────────────

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeHistory(entries) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {}
}

// ─── Record a completed quiz ──────────────────────────────────────────────────
/**
 * Call this after every quiz ends.
 * @param {object} result
 * @param {number}   result.percentage     - 0–100 overall score
 * @param {string[]} result.strongTopics   - topics answered correctly
 * @param {string[]} result.weakTopics     - topics answered incorrectly
 * @param {string}   result.courseName     - e.g. "Organic Chemistry"
 * @param {string}   result.courseId       - internal course ID
 * @param {string}   [result.quizMode]     - 'study' | 'exam'
 */
export function recordQuizResult({ percentage, strongTopics = [], weakTopics = [], courseName = '', courseId = '', quizMode = 'study' }) {
  const entry = {
    percentage: Math.round(percentage),
    strongTopics: strongTopics.filter(Boolean).slice(0, 10),
    weakTopics: weakTopics.filter(Boolean).slice(0, 10),
    courseName,
    courseId,
    quizMode,
    timestamp: Date.now(),
  };

  const history = readHistory();
  history.unshift(entry); // newest first
  // Prune to max entries
  writeHistory(history.slice(0, MAX_HISTORY_ENTRIES));

  // Also update the existing learningProfile's recentDifficulties / topicsCovered
  try {
    const PROFILE_KEY = 'studyhub_learning_profile';
    const profileRaw = localStorage.getItem(PROFILE_KEY);
    const profile = profileRaw ? JSON.parse(profileRaw) : {};

    // Merge: keep unique topics, newest first, cap at 20
    const prevDifficulties = profile.recentDifficulties || [];
    const allDifficulties = [...new Set([...weakTopics, ...prevDifficulties])].slice(0, 20);

    const prevCovered = profile.topicsCovered || [];
    const allCovered = [...new Set([...strongTopics, ...prevCovered])].slice(0, 50);

    localStorage.setItem(PROFILE_KEY, JSON.stringify({
      ...profile,
      recentDifficulties: allDifficulties,
      topicsCovered: allCovered,
    }));
    window.dispatchEvent(new CustomEvent('studyhub-profile-updated'));
  } catch {}
}

// ─── Smart Recommendations ────────────────────────────────────────────────────
/**
 * Returns an array of up to 3 personalized recommendation objects for the home feed.
 * Each item: { type, topic, courseName, courseId, score, daysSince, message, emoji, cta, route }
 */
export function getSmartRecommendations() {
  const history = readHistory();
  if (history.length === 0) return [];

  const now = Date.now();
  const MS_PER_DAY = 86_400_000;
  const recommendations = [];
  const seen = new Set(); // avoid duplicate topics

  // 1. RETRY — weak topics from recent sessions (score < 60%)
  for (const entry of history.slice(0, 10)) {
    for (const topic of entry.weakTopics) {
      if (seen.has(topic)) continue;
      seen.add(topic);
      const daysSince = Math.round((now - entry.timestamp) / MS_PER_DAY);
      recommendations.push({
        type: 'retry',
        topic,
        courseName: entry.courseName,
        courseId: entry.courseId,
        score: entry.percentage,
        daysSince,
        emoji: '📉',
        pill: 'Needs Review',
        pillColor: { bg: '#fef3c7', fg: '#92400e' }, // amber
        message: daysSince === 0
          ? `You just scored ${entry.percentage}% — keep at it!`
          : `You scored ${entry.percentage}% · ${daysSince === 1 ? 'yesterday' : `${daysSince} days ago`}`,
        cta: 'Retry Quiz',
        route: '/quiz',
      });
      if (recommendations.length >= 2) break;
    }
    if (recommendations.length >= 2) break;
  }

  // 2. DUE FOR REVIEW — strong topics not seen in 5+ days
  const recentTopics = new Set(history.slice(0, 3).flatMap(e => [...e.strongTopics, ...e.weakTopics]));
  for (const entry of history.slice(3, 15)) {
    for (const topic of entry.strongTopics) {
      if (seen.has(topic) || recentTopics.has(topic)) continue;
      const daysSince = Math.round((now - entry.timestamp) / MS_PER_DAY);
      if (daysSince < 5) continue;
      seen.add(topic);
      recommendations.push({
        type: 'review',
        topic,
        courseName: entry.courseName,
        courseId: entry.courseId,
        score: entry.percentage,
        daysSince,
        emoji: '🔁',
        pill: 'Due for Review',
        pillColor: { bg: '#eff6ff', fg: '#1d4ed8' }, // blue
        message: `Not studied in ${daysSince} days — refresh your memory`,
        cta: 'Study Now',
        route: '/quiz',
      });
      if (recommendations.length >= 3) break;
    }
    if (recommendations.length >= 3) break;
  }

  return recommendations.slice(0, 3);
}

// ─── Level-Up Suggestion ─────────────────────────────────────────────────────
/**
 * Returns a level-up suggestion if the last 3 quiz averages are > 80%,
 * or a "needs support" suggestion if average < 50%.
 * Returns null if no suggestion or already dismissed.
 */
export function getLevelUpSuggestion() {
  try {
    if (localStorage.getItem(LEVEL_UP_DISMISSED_KEY)) return null;
  } catch {}

  const history = readHistory();
  if (history.length < 3) return null;

  const recentThree = history.slice(0, 3);
  const avg = recentThree.reduce((sum, e) => sum + e.percentage, 0) / 3;

  if (avg >= 80) {
    return {
      type: 'level_up',
      avg: Math.round(avg),
      message: `Your last 3 quizzes averaged ${Math.round(avg)}% — you're crushing it! 🎓`,
      sub: 'Try Final Year difficulty in Settings to keep challenging yourself.',
      emoji: '🎓',
      cta: 'Go to Settings',
      route: '/settings',
    };
  }

  if (avg < 50) {
    return {
      type: 'support',
      avg: Math.round(avg),
      message: `Struggling a bit? That's completely normal. 💪`,
      sub: 'Try switching to "Exam Cram" mode in Settings for high-yield, concise answers.',
      emoji: '💪',
      cta: 'Go to Settings',
      route: '/settings',
    };
  }

  return null;
}

export function dismissLevelUpSuggestion() {
  try {
    localStorage.setItem(LEVEL_UP_DISMISSED_KEY, '1');
  } catch {}
}

// ─── Luna Context ─────────────────────────────────────────────────────────────
/**
 * Returns a concise context string to inject into Luna's AI system prompt.
 * Describes the student's recent performance and weak areas.
 */
export function getLunaContext() {
  const history = readHistory();
  if (history.length === 0) return '';

  const recent = history.slice(0, 3);
  const allWeak = [...new Set(recent.flatMap(e => e.weakTopics))].slice(0, 5);
  const lastEntry = history[0];
  const parts = [];

  if (lastEntry) {
    parts.push(`The student's most recent quiz was on "${lastEntry.courseName}" with a score of ${lastEntry.percentage}%.`);
  }
  if (allWeak.length > 0) {
    parts.push(`Known weak areas from recent sessions: ${allWeak.join(', ')}.`);
  }

  return parts.join(' ');
}

/**
 * Returns the most recent weak topics for display in Luna's empty state greeting.
 * Returns [] if no history.
 */
export function getRecentWeakTopics() {
  const history = readHistory();
  if (history.length === 0) return [];
  const allWeak = [...new Set(history.slice(0, 3).flatMap(e => e.weakTopics))];
  return allWeak.slice(0, 2);
}

/**
 * Returns the most recent quiz course name and score for display.
 */
export function getLastQuizSummary() {
  const history = readHistory();
  if (history.length === 0) return null;
  const last = history[0];
  return { courseName: last.courseName, percentage: last.percentage, weakTopics: last.weakTopics };
}
