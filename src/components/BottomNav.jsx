import { NavLink } from 'react-router-dom';
import { Home, FileText, BookOpen, Brain } from 'lucide-react';

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/papers', icon: FileText, label: 'Papers' },
  { to: '/programs', icon: BookOpen, label: 'Notes' },
  { to: '/quiz', icon: Brain, label: 'Quiz' },
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 safe-area-inset-bottom">
      <div className="flex items-stretch h-16">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              [
                'flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150',
                isActive
                  ? 'text-blue-600'           // ✅ active text = blue
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={[
                    'flex items-center justify-center w-10 h-6 rounded-full transition-colors duration-150',
                    isActive ? 'bg-blue-50' : '',   // ✅ active background = light blue
                  ].join(' ')}
                >
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.5 : 1.75}
                    className={isActive ? 'text-blue-600' : ''} // ✅ icon also blue
                  />
                </span>
                <span className="text-[11px] leading-none tracking-wide">
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}