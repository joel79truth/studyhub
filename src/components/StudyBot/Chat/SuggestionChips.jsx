import { useContext } from 'react';
import { UserContext } from '../../../context/UserContext';

const DEFAULT_SUGGESTIONS = [
  'Explain photosynthesis',
  'Help me with calculus',
  'Essay writing tips',
  'Study schedule advice',
  'Summarise a concept',
];

export default function SuggestionChips({ onSend, show }) {
  const { user } = useContext(UserContext);
  const recentTopics = user.history?.slice(-3).map(msg => msg.text) || [];
  const suggestions = recentTopics.length > 0 ? recentTopics : DEFAULT_SUGGESTIONS;

  if (!show) return null;

  return (
    <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', padding:'0 12px 10px' }}>
      {suggestions.map(chip => (
        <button
          key={chip}
          onClick={() => onSend(chip)}
          style={{
            display:'inline-block', padding:'5px 11px', borderRadius:'20px',
            background:'#eff6ff', border:'1px solid #bfdbfe', color:'#2563eb',
            fontSize:'12px', fontWeight:'500', cursor:'pointer', whiteSpace:'nowrap'
          }}
          aria-label={`Suggestion: ${chip}`}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}