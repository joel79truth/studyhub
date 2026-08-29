import { NavLink } from 'react-router-dom';
import { Home, FileText, BookOpen, Brain } from 'lucide-react';
import { memo } from 'react';

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/papers', icon: FileText, label: 'Papers' },
  { to: '/programs', icon: BookOpen, label: 'Notes' },
  { to: '/quiz', icon: Brain, label: 'Quiz' },
];

export const BottomNav = memo(function BottomNav() {
  return (
    <nav className="fixed bottom-3 left-3 right-3 z-50 bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg rounded-2xl safe-area-inset-bottom">
      <div className="flex items-stretch h-16">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            // ⬇️ THE MAGIC: prefetch the page chunk on hover/focus
            prefetch="intent"
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-1 select-none transition-colors duration-150 ${
                isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex items-center justify-center w-10 h-8 rounded-full transition-all duration-200 ${
                    isActive
                      ? 'bg-blue-50 scale-105 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]'
                      : 'scale-100'
                  }`}
                >
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.75 : 2}
                    className={`transition-all duration-200 ${
                      isActive
                        ? 'text-blue-600 drop-shadow-[0_0_6px_rgba(59,130,246,0.3)] scale-110'
                        : 'scale-100'
                    }`}
                  />
                </span>
                <span
                  className={`text-[11px] leading-none tracking-wide transition-all duration-200 ${
                    isActive
                      ? 'font-semibold -translate-y-0.5'
                      : 'font-normal translate-y-0'
                  }`}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
});