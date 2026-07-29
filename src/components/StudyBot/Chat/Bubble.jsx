// components/StudyBot/Chat/Bubble.jsx
export default function Bubble({ isUser, children }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? '#3b82f6' : '#ffffff',
          color: isUser ? '#ffffff' : '#1e293b',
          border: isUser ? 'none' : '1px solid #e8edf8',
          boxShadow: isUser
            ? '0 1px 4px rgba(59,130,246,0.3)'
            : '0 1px 4px rgba(60,100,200,0.09)',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
        }}
      >
        {children}
      </div>
    </div>
  );
}