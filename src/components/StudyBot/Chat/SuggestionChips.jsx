import { useContext, useMemo } from 'react';
import { UserContext } from '../../../context/UserContext';
import { getLastQuizSummary, getRecentWeakTopics } from '../../../services/learningIntelligence';

const DEFAULT_SUGGESTIONS = [
  'Explain photosynthesis',
  'Help me with calculus',
  'Essay writing tips',
  'Study schedule advice',
  'Summarise a concept',
];

export default function SuggestionChips({ onSend, show }) {
  const { user } = useContext(UserContext);

  // Build personalized suggestions from quiz history, fall back to defaults
  const suggestions = useMemo(() => {
    const lastQuiz = getLastQuizSummary();
    const weakTopics = getRecentWeakTopics();

    if (weakTopics.length > 0 && lastQuiz) {
      // Data-driven: prompt directly on the student's actual weak areas
      const chips = [
        `Explain ${weakTopics[0]} in simple terms`,
        `What are the key points in ${lastQuiz.courseName || 'my last topic'}?`,
        `Give me practice questions on ${weakTopics[0]}`,
      ];
      if (weakTopics[1]) chips.push(`Compare ${weakTopics[0]} and ${weakTopics[1]}`);
      chips.push('Help me make a study plan');
      return chips.slice(0, 5);
    }

    // Fallback: use user chat history topics if available, else generic defaults
    const recentTopics = user.history?.slice(-3).map(msg => msg.text) || [];
    return recentTopics.length > 0 ? recentTopics : DEFAULT_SUGGESTIONS;
  }, [user.history]);

  if (!show) return null;

  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '0 12px 10px' }}>
      {suggestions.map(chip => (
        <button
          key={chip}
          onClick={() => onSend(chip)}
          style={{
            display: 'inline-block', padding: '5px 11px', borderRadius: '20px',
            background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb',
            fontSize: '12px', fontWeight: '500', cursor: 'pointer', whiteSpace: 'nowrap'
          }}
          aria-label={`Suggestion: ${chip}`}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}