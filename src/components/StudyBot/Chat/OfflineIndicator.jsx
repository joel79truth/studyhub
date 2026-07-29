import { useOnlineStatus } from '../../../hooks/useOnlineStatus';

export default function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div style={{
      position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
      padding: '4px 14px', borderRadius: '12px',
      background: '#fee2e2', color: '#b91c1c', fontSize: '12px', fontWeight: '600',
      border: '1px solid #fca5a5', backdropFilter: 'blur(4px)',
      zIndex: 15, whiteSpace: 'nowrap',
    }}>
      You are offline. Messages will be sent when connection restores.
    </div>
  );
}