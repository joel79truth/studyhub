// components/LunaOrb.js
import { Sparkles } from 'lucide-react';

export default function LunaOrb({ mood = 'idle', size = 38, isThinking = false }) {
  const anim = {
    idle: 'lunaIdle 3s ease-in-out infinite',
    thinking: 'lunaThink 0.8s ease-in-out infinite',
    replying: 'lunaReply 1s ease-in-out infinite',
    happy: 'lunaHappy 0.6s ease-in-out 1',
  };
  const color = {
    idle: '#3b82f6',
    thinking: '#8b5cf6',
    replying: '#06b6d4',
    happy: '#10b981',
  };

  // If isThinking is true, override mood to 'thinking' for the animation
  const activeMood = isThinking ? 'thinking' : mood;
  const activeAnim = anim[activeMood];
  const activeColor = color[activeMood];

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: `radial-gradient(circle at 35% 35%, ${activeColor}dd, ${activeColor}88)`,
        boxShadow: `0 2px 12px ${activeColor}55`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: activeAnim,
        transition: 'background 0.4s, box-shadow 0.4s',
      }}
    >
      <Sparkles size={size * 0.45} color="#fff" fill="#fff" />
      <style>{`
        @keyframes lunaIdle {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes lunaThink {
          0%, 100% { transform: scale(1); box-shadow: 0 0 12px ${activeColor}55; }
          50% { transform: scale(1.15); box-shadow: 0 0 30px ${activeColor}aa; }
        }
        @keyframes lunaReply {
          0%, 100% { transform: rotate(0deg) scale(1); }
          25% { transform: rotate(4deg) scale(1.02); }
          75% { transform: rotate(-4deg) scale(1.02); }
        }
        @keyframes lunaHappy {
          0% { transform: scale(1); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}