// ============================================================================
// Student Learning Profile Service
// Manages student academic level, explanation style preferences,
// and learning memory so StudyHub AI adapts to each individual learner.
// ============================================================================

const STORAGE_KEY_PROFILE = 'studyhub_learning_profile';

export const ACADEMIC_LEVELS = [
  { id: 'first_year', label: '1st Year / Fundamentals', desc: 'Focus on clear foundational concepts without assumed prior knowledge' },
  { id: 'undergrad', label: 'Undergraduate (Year 2-3)', desc: 'Standard university depth with rigorous terminology and mechanisms' },
  { id: 'final_year', label: 'Final Year / Advanced', desc: 'Deep technical rigor, edge cases, and high-level synthesis' },
  { id: 'exam_prep', label: 'Exam Cram / Revision', desc: 'High-yield definitions, scoring points, and exam structure' },
];

export const EXPLANATION_STYLES = [
  { id: 'intuitive', label: 'Intuitive & Analogies', icon: '💡', desc: 'Relatable real-world analogies and visual metaphors' },
  { id: 'step_by_step', label: 'Step-by-Step Logic', icon: '🪜', desc: 'Deconstruct complex ideas and calculations line-by-line' },
  { id: 'concise', label: 'Crisp & Direct', icon: '⚡', desc: 'Fast, to-the-point answers with zero filler' },
  { id: 'exam_oriented', label: 'Exam Focus & Marks', icon: '🎯', desc: 'Highlight keywords examiners look for and mark-winning phrases' },
];

const DEFAULT_PROFILE = {
  academicLevel: 'undergrad',
  explanationStyle: 'intuitive',
  studyPace: 'balanced', // 'gentle', 'balanced', 'intense'
  preferredTone: 'encouraging', // 'encouraging', 'direct', 'socratic'
  topicsCovered: [],
  recentDifficulties: [],
};

export function getLearningProfile() {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to load learning profile:', err);
    return DEFAULT_PROFILE;
  }
}

export function saveLearningProfile(updates) {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const current = getLearningProfile();
    const updated = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('studyhub-profile-updated', { detail: updated }));
    return updated;
  } catch (err) {
    console.error('Failed to save learning profile:', err);
    return getLearningProfile();
  }
}

export function formatProfileForPrompt(profile, courseContext = '') {
  const p = profile || getLearningProfile();
  const levelObj = ACADEMIC_LEVELS.find(l => l.id === p.academicLevel) || ACADEMIC_LEVELS[1];
  const styleObj = EXPLANATION_STYLES.find(s => s.id === p.explanationStyle) || EXPLANATION_STYLES[0];

  let summary = `Student Profile: ${levelObj.label}. Explanation Style: ${styleObj.label} (${styleObj.desc}).`;
  if (courseContext) {
    summary += ` Subject / Course: ${courseContext}.`;
  }
  return summary;
}
