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
    <nav className="fixed bottom-3 left-3 right-3 z-50 bg-white border border-gray-200 shadow-lg rounded-2xl safe-area-inset-bottom">
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
                  ? 'text-blue-600'           // ✅ active text stays blue
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={[
                    'flex items-center justify-center w-10 h-8 rounded-full transition-colors duration-150', // h-8 for larger icons
                    isActive ? 'bg-blue-50' : '',   // ✅ active background stays blue-50
                  ].join(' ')}
                >
                  <Icon
                    size={22}                       // ✅ bigger icons (was 20)
                    strokeWidth={isActive ? 2.75 : 2}  // ✅ thicker icons (was 2.5 / 1.75)
                    className={isActive ? 'text-blue-600' : ''}
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