import { Sparkles } from 'lucide-react';

export default function LunaOrb({ mood = 'idle', size = 38 }) {
  const anim = {
    idle: 'lunaIdle 3s ease-in-out infinite',
    thinking: 'lunaThink .8s ease-in-out infinite',
    replying: 'lunaReply 1s ease-in-out infinite',
    happy: 'lunaHappy .6s ease-in-out 1',
  };
  const color = {
    idle: '#3b82f6',
    thinking: '#8b5cf6',
    replying: '#06b6d4',
    happy: '#10b981',
  };

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: `radial-gradient(circle at 35% 35%, ${color[mood]}dd, ${color[mood]}88)`,
        boxShadow: `0 2px 12px ${color[mood]}55`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: anim[mood],
        transition: 'background .4s, box-shadow .4s',
      }}
    >
      <Sparkles size={size * 0.45} color="#fff" fill="#fff" />
    </div>
  );
}